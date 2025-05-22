import { Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CachedPresence, MembershipCheck, ServiceEvent, ServiceMessage, SocketSend } from 'hide-common';
import { EnvWorkspaceOpen } from 'hide-common/message/env.message';
import { RedisService } from 'hide-redis';
import Redis from 'ioredis';
import Redlock from 'redlock';
import { firstValueFrom } from 'rxjs';
import { CommonRef } from 'src/common/refs/common.ref';
import { WSSharedDoc } from 'src/utils/shareddoc';

@Injectable()
export class WorkspaceService {
  cache: Cache;
  redlock: Redlock;
  lockClient: Redis;

  conns: Map<string, Map<string, Map<string, WSSharedDoc>>>;

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    @Inject('ENV_SERVICE_RMQ') private readonly rmq: ClientProxy,
    private readonly cacheService: RedisService,
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
}
