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

@Controller('api')
export class CoreController implements OnModuleInit, OnModuleDestroy {
  redisServer: [Redis, Redis];
  cache: Cache;
  instanceId: string;
  channels: string[];

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    private readonly sshService: SSHProxyService,
    private readonly cacheService: RedisService,
    private readonly workspaceService: WorkspaceService,
  ) {
    CommonRef.setInstanceId(randomUUID());
    this.instanceId = CommonRef.getInstanceId();
    this.cache = this.cacheService.get();
    this.channels = [`env.${this.instanceId}`, `env.${this.instanceId}.health`];
  }

  async onModuleInit() {
    this.redisServer = RedisRef.get();
    const [pub, sub] = this.redisServer;

    await sub.subscribe(...this.channels);
    sub.on('message', (chan, message) => {
      if (!this.channels.includes(chan)) return;

      if (chan.endsWith('.health')) {
        const evt = JSON.parse(message) as { id: string };
        void pub.publish(`${chan}.reply`, JSON.stringify({ id: evt.id, data: {}, pattern: `${chan}.reply` }));
        return;
      }

      const evt = JSON.parse(message) as { data: ServiceEvent<InSocketMessage<'env' | 'internal'>> };
      const { uid, sessionId } = evt.data.meta || {};
      if (!uid || !sessionId) return;
      void this.workspaceService.handleStickyEnvMessage(uid, sessionId, evt.data.payload);
    });
  }
  async onModuleDestroy() {
    await this.redisServer[1].removeAllListeners().unsubscribe(...this.channels);
  }

  @MessagePattern('env.msg', Transport.NATS)
  async handleEnvMessage(msg: ServiceMessage<InSocketMessage<'env'>>) {
    const { uid, sessionId } = msg.meta || {};
    if (!uid || !sessionId) return;
    await this.workspaceService.handleEnvMessage(uid, sessionId, msg.payload);
  }

  /*
  handleSyncEvent(msg: Message<FSDocSyncEvent>) {
    this.syncService.handleFSUpdate(msg);
  }
  async handleSaveEvent(msg: Message<FSSaveRequest>) {
    await this.syncService.handleFSSave(msg);
  } */
}
