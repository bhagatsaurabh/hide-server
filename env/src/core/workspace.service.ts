import { Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CachedWorkspace,
  CACHEKEY_WORKSPACE,
  EnvOpenRequest,
  InSocketMessage,
  InternalMessage,
  MembershipCheck,
  RpcError,
  ServiceEvent,
  ServiceMessage,
  SocketSend,
  StatDTO,
} from 'hide-common';
import { FSClose, FSOpen } from 'hide-common/message/filesystem.message';
import { RedisService } from 'hide-redis';
import Redis from 'ioredis';
import Redlock from 'redlock';
import { FSService } from './fs.service';
import { SyncService } from './sync.service';
import { SSHProxyService } from './sshproxy.service';
import { CommonRef } from 'src/common/refs/common.ref';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WorkspaceService {
  root = '/home/devuser/workspace';
  cache: Cache;
  redlock: Redlock;
  lockClient: Redis;
  stickyActions = ['fs.sync', 'ssh.data', 'ssh.close', 'workspace.watch', 'doc.hash'];

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    @Inject('ENV_SERVICE_RMQ') private readonly rmq: ClientProxy,
    private readonly cacheService: RedisService,
    private readonly fsService: FSService,
    private readonly syncService: SyncService,
    private readonly sshService: SSHProxyService,
  ) {
    this.cache = this.cacheService.get();
  }
  async handleEnvOpen(uid: string, msg: EnvOpenRequest) {
    let member = false;
    try {
      member = await this.isAMember(uid, msg.uuid);
    } catch (error) {
      void error;
      throw new RpcError(500, 'Could not check membership');
    }
    if (!member) {
      throw new RpcError(401, 'Not a workspace member');
    }

    const lock = await this.acquireLock(msg.uuid);
    if (!lock) throw new Error('Could not acquire lock on workspace');

    try {
      let workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(msg.uuid));
      let dirty = false;
      if (!workspace) {
        workspace = { dirs: {}, fs: CommonRef.getInstanceId(), docs: {}, sshs: {}, state: 'active' };
        dirty = true;
      }
      if (!workspace.dirs) {
        workspace.fs = CommonRef.getInstanceId();
        dirty = true;
      }
      if (dirty) {
        this.redis.emit(`workspace.${msg.uuid}.affine`, { envInstanceId: CommonRef.getInstanceId() });
        this.fsService.setWorkspace(msg.uuid);
        await this.cache.set(CACHEKEY_WORKSPACE(msg.uuid), workspace);
      }
    } finally {
      await lock.release();
    }
  }
  async handleEnvMessage(uid: string, sessionId: string, msg: InSocketMessage<'env'>) {
    if (this.stickyActions.includes(msg.action)) return;

    switch (msg.action) {
      case 'ssh.request': {
        this.sshService.handleRequest(uid, sessionId, msg.payload);
        break;
      }
      case 'fs.open': {
        await this.handleOpen(uid, sessionId, msg.payload, msg.correlationId);
        break;
      }
      case 'fs.close': {
        await this.handleClose(uid, msg.payload);
        break;
      }
      default:
        break;
    }
  }
  async handleStickyEnvMessage(
    uid: string,
    sessionId: string,
    evt: InternalMessage<ServiceEvent<InSocketMessage<'env' | 'internal'>>>,
    chan: string,
  ): Promise<{
    evt: InternalMessage<ServiceEvent<InSocketMessage<'env' | 'internal'>>>;
    value: unknown;
    chan: string;
  }> {
    const { payload: msg } = evt.data;
    if (!this.stickyActions.includes(msg.action)) return { evt, value: null, chan };

    let value: unknown;
    switch (msg.action) {
      case 'workspace.watch': {
        value = await this.fsService.handleWatchEvent(msg.payload);
        break;
      }
      case 'doc.hash': {
        value = this.syncService.docs.get(msg.payload.uuid)?.get(msg.payload.path)?.computeHash();
        break;
      }
      case 'ssh.data': {
        value = this.sshService.handleSSHData(uid, sessionId, msg.payload);
        break;
      }
      case 'ssh.close': {
        value = this.sshService.handleSSHClose(uid, sessionId, msg.payload);
        break;
      }
      case 'fs.sync': {
        value = await this.syncService.handleSync(uid, sessionId, msg.payload);
        break;
      }
      default:
        break;
    }
    return { evt, value, chan };
  }

  async getStat(wsUuid: string, path: string) {
    const res = await fetch(`http://workspace-${wsUuid}/api/stat?path=${path}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    return (await res.json()) as StatDTO;
  }

  async handleOpen(uid: string, sessionId: string, msg: FSOpen, correlationId?: string) {
    const path = this.root + msg.path;

    try {
      const stat = await this.getStat(msg.uuid, path);
      if (stat.isDir) {
        return await this.fsService.openDir(uid, sessionId, msg, correlationId);
      }
      return await this.syncService.openFile(uid, sessionId, msg, correlationId);
    } catch (err) {
      console.log(err);
      if (correlationId) {
        this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
          meta: { uid, sessionId },
          payload: {
            uid,
            sessionId,
            pattern: correlationId,
            msg: { action: 'error', payload: { error: { code: 'UNKNOWN' } } },
          },
        });
      }
    }
  }
  async handleClose(uid: string, msg: FSClose) {
    const path = this.root + msg.path;
    try {
      const stat = await this.getStat(msg.uuid, path);
      if (stat.isDir) {
        return await this.fsService.closeDir(uid, msg.uuid, path);
      }
      return await this.syncService.closeFile(uid, msg.uuid, path);
    } catch (err) {
      console.log(err);
      return;
    }
  }

  async acquireLock(uuid: string) {
    this.lockClient = new Redis(parseInt(process.env.REDIS_PORT!), process.env.REDIS_HOST!);
    this.redlock = new Redlock([this.lockClient], { retryCount: 3 });

    try {
      return await this.redlock.acquire([`locks:workspace:${uuid}`], 10 * 1000);
    } catch (error) {
      void error;
      return null;
    }
  }
  async isAMember(uid: string, wsUuid: string) {
    const observable = this.rmq.send<boolean, ServiceMessage<MembershipCheck>>('workspace.membership.check', {
      payload: { uid, uuid: wsUuid },
    });
    return await firstValueFrom(observable);
  }
}
