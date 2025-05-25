import { Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CachedPresence,
  MembershipCheck,
  ServiceEvent,
  ServiceMessage,
  SocketSend,
  StatDTO,
} from 'hide-common';
import { EnvWorkspaceOpen } from 'hide-common/message/env.message';
import { FSClose, FSEvent, FSOpen } from 'hide-common/message/filesystem.message';
import { RedisService } from 'hide-redis';
import Redis from 'ioredis';
import Redlock from 'redlock';
import { firstValueFrom } from 'rxjs';
import { CommonRef } from 'src/common/refs/common.ref';
import { WSSharedDoc } from 'src/utils/shareddoc';
import { FSService } from './fs.service';
import { SyncService } from './sync.service';

// uid
export type UserState = Map<string, Sessions>;
// sessionId
export type Sessions = Map<string, SessionState>;
export type SessionState = {
  docs: ActiveDocs;
};
// path
export type ActiveDocs = Map<string, WSSharedDoc>;

@Injectable()
export class WorkspaceService {
  root = '/home/devuser/workspace';
  cache: Cache;
  redlock: Redlock;
  lockClient: Redis;

  conns: UserState;

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    @Inject('ENV_SERVICE_RMQ') private readonly rmq: ClientProxy,
    private readonly cacheService: RedisService,
    private readonly fsService: FSService,
    private readonly syncService: SyncService,
  ) {
    this.cache = this.cacheService.get();
  }

  async handleWorkspaceOpen(uid: string, msg: EnvWorkspaceOpen, correlationId?: string) {
    const lock = await this.handleAffinity(msg.uuid);
    if (!lock) {
      this.redis.emit<any, ServiceEvent<SocketSend<'env'>>>('socket.send', {
        payload: { uid, pattern: 'env', msg: { action: 'workspace.open.wait', payload: { correlationId } } },
      });
      return;
    } else {
      await this.cache.set(`workspace:${msg.uuid}`, CommonRef.getInstanceId());
      await lock.release();
    }

    try {
      const observable = this.rmq.send<boolean, ServiceMessage<MembershipCheck>>(
        'workspace.membership.check',
        {
          payload: { uid, uuid: msg.uuid },
        },
      );
      if (!(await firstValueFrom(observable))) {
        this.redis.emit<any, ServiceEvent<SocketSend<'env'>>>('socket.send', {
          payload: {
            uid,
            pattern: 'env',
            msg: { action: 'error', payload: { correlationId, code: 'NOT_A_MEMBER' } },
          },
        });
        return;
      }

      const presence = await this.cache.get<CachedPresence>(`presence:${uid}`);
      if (!presence) {
        this.redis.emit<any, ServiceEvent<SocketSend<'env'>>>('socket.send', {
          payload: {
            uid,
            pattern: 'env',
            msg: { action: 'error', payload: { correlationId, code: 'WORKSPACE_NOT_OPENED' } },
          },
        });
        return;
      }

      const instanceId = CommonRef.getInstanceId();
      presence.sockets[msg.socketId] = msg.uuid;
      presence.workspaces[`${msg.socketId}:${msg.uuid}`] = instanceId;
      await this.cache.set(`presence:${uid}`, presence);
      await this.cache.set(`presence:${uid}:${msg.socketId}`, msg.uuid, 20000);
      await this.cache.set(`presence:${uid}:${msg.socketId}:${msg.uuid}`, instanceId, 30000);
      return null;
    } catch (error) {
      void error;
      this.redis.emit<any, ServiceEvent<SocketSend<'env'>>>('socket.send', {
        payload: {
          uid,
          pattern: 'env',
          msg: { action: 'error', payload: { correlationId, code: 'UNKNOWN' } },
        },
      });
    }
  }

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

  async setWorkspaceActive(uid: string, sessionId: string) {
    const active = await this.cache.get<1 | 0>(`affinity:${uid}:${sessionId}`);
    if (active === 0) {
      await this.cache.set<1 | 0>(`affinity:${uid}:${sessionId}`, 1);
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
