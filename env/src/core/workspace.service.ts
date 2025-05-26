import { Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InSocketMessage, StatDTO } from 'hide-common';
import { FSClose, FSEvent, FSOpen } from 'hide-common/message/filesystem.message';
import { RedisService } from 'hide-redis';
import Redis from 'ioredis';
import Redlock from 'redlock';
import { WSSharedDoc } from 'src/utils/shareddoc';
import { FSService } from './fs.service';
import { SyncService } from './sync.service';
import { SSHProxyService } from './sshproxy.service';

// docId
export type ActiveDocs = Map<string, WSSharedDoc>;
// wsUuid
export type WorkspaceState = Map<string, ActiveDocs>;

@Injectable()
export class WorkspaceService {
  root = '/home/devuser/workspace';
  cache: Cache;
  redlock: Redlock;
  lockClient: Redis;
  stickyActions = ['fs.sync', 'fs.save', 'ssh.data', 'ssh.close'];

  state: WorkspaceState;

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

  handleEnvMessage(uid: string, sessionId: string, msg: InSocketMessage<'env'>) {
    if (this.stickyActions.includes(msg.action)) return;

    switch (msg.action) {
      case 'ssh.request': {
        this.sshService.handleRequest(uid, sessionId, msg.payload);
        break;
      }
      case 'fs.open': {
        // TODO
        break;
      }
      case 'fs.close': {
        // TODO
        break;
      }
      default:
        break;
    }
  }
  async handleStickyEnvMessage(uid: string, sessionId: string, msg: InSocketMessage<'env' | 'internal'>) {
    if (!this.stickyActions.includes(msg.action)) return;

    switch (msg.action) {
      case 'ssh.data': {
        this.sshService.handleSSHData(uid, sessionId, msg.payload);
        break;
      }
      case 'ssh.close': {
        await this.sshService.handleSSHClose(uid, sessionId, msg.payload);
        break;
      }
      case 'ssh.closeall': {
        await this.sshService.handleSSHCloseAll(uid, sessionId, msg.payload);
        break;
      }
      case 'fs.sync': {
        // TODO
        break;
      }
      case 'fs.save': {
        // TODO
        break;
      }

      /*
      case 'workspace.watch': {
        void this.workspaceService.handleWatchEvent(uid, sessionId, msg.payload);
        break;
      }
      case 'session.disconnect': {
        // TODO: Verify if wsUuid is handled by this instance & uid:sessionId is active here
        const msg = msg.payload;
        void this.cache.set<1 | 0>(`presence:${msg.uid}:${msg.sessionId}:${msg.uuid}`, 0, 150000);
        break;
      }
      case 'session.ping': {
        // TODO: Verify if wsUuid is handled by this instance & uid:sessionId is active here
        const msg = msg.payload;
        void this.cache.set<1 | 0>(`presence:${msg.uid}:${msg.sessionId}:${msg.uuid}`, 1, 30000);
        break;
      } */
      default:
        break;
    }
  }

  //////////////////////

  async handleAffinity(uuid: string) {
    this.lockClient = new Redis(parseInt(process.env.REDIS_PORT!), process.env.REDIS_HOST!);
    this.redlock = new Redlock([this.lockClient], { retryCount: 0 });

    try {
      return await this.redlock.acquire([`locks:workspace:${uuid}`], 20 * 1000);
    } catch (error) {
      void error;
      return null;
    }
  }

  async getStat(wsUuid: string, path: string) {
    const res = await fetch(`http://workspace-${wsUuid}/api/stat?path=${path}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    return (await res.json()) as StatDTO;
  }

  async handleOpen(uid: string, msg: FSOpen) {
    const path = this.root + msg.path;
    try {
      const stat = await this.getStat(msg.uuid, path);
      if (stat.isDir) {
        return await this.fsService.openDir(uid, path);
      }
      return this.syncService.openFile(uid, path);
    } catch (err) {
      console.log(err);
      return [];
    }
  }

  async handleClose(uid: string, msg: FSClose) {
    const path = this.root + msg.path;
    try {
      const stat = await this.getStat(msg.uuid, path);
      if (stat.isDir) {
        return this.fsService.closeDir(uid, path);
      }
      return this.syncService.closeFile(uid, path);
    } catch (err) {
      console.log(err);
      return;
    }
  }

  async handleWatchEvent(uid: string, sessionId: string, event: FSEvent) {
    // TODO
  }
}
