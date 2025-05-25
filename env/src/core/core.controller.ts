import { randomUUID } from 'node:crypto';
import { Controller, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClientProxy, MessagePattern, Transport } from '@nestjs/microservices';
import { InSocketMessage, ServiceEvent, ServiceMessage } from 'hide-common';
import Redis from 'ioredis';
import { RedisRef } from 'src/common/refs/redis.ref';
import { SSHProxyService } from './sshproxy.service';
import { Cache } from '@nestjs/cache-manager';
import { RedisService } from 'hide-redis';
import { WorkspaceService } from './workspace.service';
import { CommonRef } from 'src/common/refs/common.ref';
import { EnvWorkspaceOpen } from 'hide-common/message/env.message';

@Controller('api')
export class CoreController implements OnModuleInit, OnModuleDestroy {
  redisServer: [Redis, Redis];
  cache: Cache;
  instanceId: string;

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    private readonly sshService: SSHProxyService,
    private readonly cacheService: RedisService,
    private readonly workspaceService: WorkspaceService,
  ) {
    CommonRef.setInstanceId(randomUUID());
    this.instanceId = CommonRef.getInstanceId();
    this.cache = this.cacheService.get();
  }

  async onModuleInit() {
    this.redisServer = RedisRef.get();
    const sub = this.redisServer[1];

    const channel = `env.${this.instanceId}`;
    await sub.subscribe(channel);
    sub.on('message', (chan, message) => {
      if (chan !== channel) return;

      const evt = JSON.parse(message) as ServiceEvent<InSocketMessage<'env' | 'internal'>>;
      if (!evt.meta?.uid || !evt.meta.sessionId) return;

      const uid = evt.meta.uid;
      const sessionId = evt.meta.sessionId;

      // User sent message
      if (evt.payload.service === 'env') {
        // TODO: Verify if wsUuid is handled by this instance & uid:sessionId is active here
        void this.workspaceService.setWorkspaceActive(uid, sessionId);
      }

      switch (evt.payload.action) {
        case 'ssh.request': {
          this.sshService.handleRequest(uid, evt.payload.payload);
          break;
        }
        case 'ssh.data': {
          this.sshService.handleSSHData(uid, evt.payload.payload);
          break;
        }
        case 'ssh.close': {
          this.sshService.handleSSHClose(uid, evt.payload.payload);
          break;
        }
        case 'ssh.closeall': {
          this.sshService.handleSSHCloseAll(uid, evt.payload.payload);
          break;
        }
        case 'fs.open': {
          void this.workspaceService.handleOpen(uid, evt.payload.payload);
          break;
        }
        case 'fs.close': {
          break;
        }
        case 'fs.sync': {
          break;
        }
        case 'workspace.watch': {
          void this.workspaceService.handleWatchEvent(uid, sessionId, evt.payload.payload);
          break;
        }
        case 'session.disconnect': {
          // TODO: Verify if wsUuid is handled by this instance & uid:sessionId is active here
          const msg = evt.payload.payload;
          void this.cache.set<1 | 0>(`presence:${msg.uid}:${msg.sessionId}:${msg.uuid}`, 0, 150000);
          break;
        }
        case 'session.ping': {
          // TODO: Verify if wsUuid is handled by this instance & uid:sessionId is active here
          const msg = evt.payload.payload;
          void this.cache.set<1 | 0>(`presence:${msg.uid}:${msg.sessionId}:${msg.uuid}`, 1, 30000);
          break;
        }
        default:
          break;
      }
    });
  }
  async onModuleDestroy() {
    await this.redisServer[1].removeAllListeners().unsubscribe(`env.${this.instanceId}`);
  }

  @MessagePattern('workspace.open', Transport.RMQ)
  async handleWorkspaceOpen(msg: ServiceMessage<InSocketMessage<'env'>>) {
    await this.workspaceService.handleWorkspaceOpen(
      msg.meta!.uid,
      msg.payload as unknown as EnvWorkspaceOpen,
      msg.payload.correlationId,
    );
  }

  /*
  handleSyncEvent(msg: Message<FSDocSyncEvent>) {
    this.syncService.handleFSUpdate(msg);
  }
  async handleSaveEvent(msg: Message<FSSaveRequest>) {
    await this.syncService.handleFSSave(msg);
  } */
}
