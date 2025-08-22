import { Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CachedPresence,
  CachedWorkspace,
  CACHEKEY_PRESENCE,
  CACHEKEY_PRESENCE_WORKSPACE,
  CACHEKEY_WORKSPACE,
  EnvCloseRequest,
  EnvOpenRequest,
  InSocketMessage,
  InternalMessage,
  MembershipCheck,
  RpcError,
  ServiceEvent,
  ServiceMessage,
  SocketSend,
  StatDTO,
  User,
  WorkspaceWaitDTO,
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
import { HttpService } from '@nestjs/axios';
import { CommandMap, WSRun } from 'hide-common/message/env.message';

@Injectable()
export class WorkspaceService {
  root = '/workspace';
  cache: Cache;
  redlock: Redlock;
  lockClient: Redis;
  stickyActions = [
    'fs.sync',
    'ssh.data',
    'ssh.close',
    'workspace.watch',
    'doc.hash',
    'fs.open.ack',
    'fs.conflict.resolve',
    'ws.run',
  ];

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    @Inject('ENV_SERVICE_RMQ') private readonly rmq: ClientProxy,
    private readonly cacheService: RedisService,
    private readonly fsService: FSService,
    readonly syncService: SyncService,
    private readonly sshService: SSHProxyService,
    private readonly http: HttpService,
  ) {
    this.cache = this.cacheService.get();
  }
  async handleEnvOpen(uid: string, user: Partial<User>, msg: EnvOpenRequest): Promise<WorkspaceWaitDTO> {
    if (!msg.sessionId) {
      throw new RpcError(400, 'Required session id');
    }
    let workspace: { image: string } | null;
    try {
      workspace = await this.isAMember(uid, msg.uuid);
    } catch (error) {
      void error;
      throw new RpcError(500, 'Could not check membership');
    }
    if (!workspace) {
      throw new RpcError(401, 'Not a workspace member');
    }

    let ready = false;
    try {
      const res = await fetch('http://provisioner/api/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
        },
        body: JSON.stringify({ image: workspace.image, uuid: msg.uuid, sessionId: msg.sessionId, uid }),
      });
      if (res.status < 200 || res.status > 299) {
        throw new Error();
      }
      ready = !((await res.json()) as WorkspaceWaitDTO).wait;
    } catch (error) {
      void error;
      throw new RpcError(401, 'Failed to open workspace');
    }

    if (!ready) {
      return { wait: true };
    }

    await this.handleEnvReady(uid, msg);

    return { wait: false };
  }
  async handleEnvReady(uid: string, msg: EnvOpenRequest) {
    try {
      await firstValueFrom(this.http.get(`http://workspace-${msg.uuid}/ready`, { timeout: 3000 }));
    } catch (error) {
      console.log(error);
      throw new RpcError(503, 'Workspace is unreachable');
    }

    const lock = await this.acquireLock(msg.uuid);
    if (!lock) throw new Error('Could not acquire lock on workspace');

    try {
      await this.invalidatePreviousSessions(uid, msg.uuid);

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
        const res = await fetch(
          `http://workspace-${msg.uuid}/api/affine?envId=${CommonRef.getInstanceId()}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          },
        );
        if (res.status < 200 || res.status > 299) {
          throw new Error();
        }
        this.fsService.setWorkspace(msg.uuid);
        await this.cache.set(CACHEKEY_WORKSPACE(msg.uuid), workspace);
      }
    } catch (error) {
      console.log(error);
      throw new RpcError(500, 'Unknown error');
    } finally {
      await lock.release();
    }

    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (presence) {
      presence[msg.sessionId].wsUuid = msg.uuid;
      await this.cache.set(CACHEKEY_PRESENCE(uid), presence);
    }
    await this.cache.set(CACHEKEY_PRESENCE_WORKSPACE(uid, msg.sessionId, msg.uuid), 1, 20000);
  }
  async handleEnvClose(uid: string, msg: EnvCloseRequest) {
    if (!(await this.isAMember(uid, msg.uuid))) return;

    const lock = await this.acquireLock(msg.uuid);
    if (!lock) return;

    try {
      const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
      if (!presence) return;

      const entries = Object.entries(presence);
      const [sessionId, _] = entries.find(([_, session]) => session.wsUuid === msg.uuid) || [];
      if (!sessionId) return;

      delete presence[sessionId].wsUuid;
      await this.cache.set(CACHEKEY_PRESENCE(uid), presence);
      await this.cache.del(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, msg.uuid));

      let workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(msg.uuid));
      if (!workspace) return;

      // Close all user ssh sessions
      await this.sshService.handleSSHClose(uid, sessionId, { uuid: msg.uuid, sshSessionId: '#all' });

      // TODO: Batch Optimization
      // Close all user opened dirs
      const dirs = Object.entries(workspace.dirs)
        .map(([path, uids]) => (uids.includes(uid) ? path : null))
        .filter((path) => !!path) as string[];
      for (const dir of dirs) {
        await this.fsService.closeDir(uid, msg.uuid, dir);
      }

      // Fetch updated workspace
      workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(msg.uuid));
      if (!workspace) return;
      if (Object.keys(workspace.dirs).length === 0) {
        // Mark for immediate de-provisioning
        workspace.state = 'inactive';
        await this.cache.set(CACHEKEY_WORKSPACE(msg.uuid), workspace);
        await this.cache.set(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, msg.uuid), 0, 200);
      }
    } finally {
      await lock.release();
    }
  }
  async handleEnvMessage(uid: string, sessionId: string, msg: InSocketMessage<'env'>) {
    if (this.stickyActions.includes(msg.action)) return;

    switch (msg.action) {
      case 'ssh.request': {
        this.sshService.handleSSHConnection(uid, sessionId, msg.payload);
        break;
      }
      case 'fs.open': {
        await this.handleOpen(uid, sessionId, msg.payload, msg.correlationId);
        break;
      }
      case 'fs.close': {
        await this.handleClose(uid, sessionId, msg.payload);
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
        value = this.syncService.docs.get(msg.payload.uuid)?.get(msg.payload.ino)?.computeHash();
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
      case 'fs.open.ack': {
        value = await this.syncService.handleOpenAck(uid, sessionId, msg.payload);
        break;
      }
      case 'fs.conflict.resolve': {
        value = await this.syncService.handleConflictResolve(uid, sessionId, msg.payload);
        break;
      }
      case 'ws.run': {
        value = await this.runCommand(uid, sessionId, msg.payload, msg.correlationId);
        break;
      }
      default:
        break;
    }
    return { evt, value, chan };
  }

  async invalidatePreviousSessions(uid: string, uuid: string) {
    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (!presence) return;

    for (const [sessionId, session] of Object.entries(presence)) {
      if (session.wsUuid === uuid) {
        delete session.wsUuid;
        await this.cache.del(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, uuid));
      }
    }
    await this.cache.set(CACHEKEY_PRESENCE(uid), presence);

    const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
    if (workspace) {
      const paths = Object.entries(workspace.dirs)
        .filter(([_, uids]) => uids.includes(uid))
        .map((dir) => dir[0]);
      this.fsService.closeDirs(uid, uuid, paths, workspace);

      await this.cache.set(CACHEKEY_WORKSPACE(uuid), workspace);
    }
  }

  async getStat(wsUuid: string, path: string) {
    const res = await fetch(`http://workspace-${wsUuid}/api/stat?path=${path}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    if (res.status < 200 || res.status > 299) {
      throw new Error('Not found');
    }
    return (await res.json()) as StatDTO;
  }

  async handleOpen(uid: string, sessionId: string, msg: FSOpen, correlationId?: string) {
    msg.path = this.root + msg.path;

    try {
      const stat = await this.getStat(msg.uuid, msg.path);
      if (stat.isDir) {
        return await this.fsService.openDir(uid, sessionId, msg, correlationId);
      }
      return await this.syncService.openFile(uid, sessionId, msg, stat, correlationId);
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
  async handleClose(uid: string, sessionId: string, msg: FSClose) {
    msg.path = this.root + msg.path;

    try {
      if (msg.ino) {
        return await this.syncService.closeFile(uid, sessionId, msg.uuid, msg.ino);
      } else {
        return await this.fsService.closeDir(uid, msg.uuid, msg.path);
      }
    } catch (err) {
      console.log(err);
      return;
    }
  }

  async runCommand(uid: string, sessionId: string, msg: WSRun<keyof CommandMap>, correlationId?: string) {
    const res = await fetch(`http://workspace-${msg.uuid}/api/command`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      method: 'POST',
      body: JSON.stringify({ command: msg.command, data: msg.ctx }),
    });
    if (correlationId) {
      if (res.status < 200 || res.status > 299) {
        this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
          meta: { uid, sessionId },
          payload: {
            uid,
            sessionId,
            pattern: correlationId,
            msg: { action: 'error', payload: { error: { code: 'UNKNOWN' } } },
          },
        });
      } else {
        this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
          meta: { uid, sessionId },
          payload: {
            uid,
            sessionId,
            pattern: correlationId,
            msg: { action: 'success', payload: {} },
          },
        });
      }
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
    try {
      const observable = this.rmq.send<{ image: string }, ServiceMessage<MembershipCheck>>(
        'workspace.membership.check',
        {
          payload: { uid, uuid: wsUuid },
        },
      );
      return await firstValueFrom(observable);
    } catch (error) {
      void error;
    }
    return null;
  }
}
