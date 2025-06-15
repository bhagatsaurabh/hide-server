import { randomUUID } from 'node:crypto';
import { Controller, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClientProxy, MessagePattern, RpcException, Transport } from '@nestjs/microservices';
import {
  EnvOpenRequest,
  HealthCheck,
  InSocketMessage,
  InternalMessage,
  RpcError,
  ServiceEvent,
  ServiceMessage,
  ServiceMessagePayload,
} from 'hide-common';
import Redis from 'ioredis';
import { RedisRef } from 'src/common/refs/redis.ref';
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
        const evt = JSON.parse(message) as InternalMessage<ServiceEvent<HealthCheck>>;
        void pub.publish(`${chan}.reply`, JSON.stringify({ id: evt.id, data: {}, pattern: `${chan}.reply` }));
        return;
      }

      const evt = JSON.parse(message) as InternalMessage<ServiceEvent<InSocketMessage<'env' | 'internal'>>>;
      let { uid, sessionId } = evt.data.meta || {};
      if (evt.data.payload.action === 'workspace.watch' || evt.data.payload.action === 'doc.hash') {
        uid = '#';
        sessionId = '#';
      }
      if (!uid || !sessionId) return;
      this.workspaceService
        .handleStickyEnvMessage(uid, sessionId, evt, chan)
        .then(({ evt: event, value, chan: channel }) => {
          if (value) {
            void pub.publish(
              `${channel}.reply`,
              JSON.stringify({ id: event.id, data: value, pattern: `${channel}.reply` }),
            );
          }
        })
        .catch((err) => void err);
    });
  }
  async onModuleDestroy() {
    await this.redisServer[1].removeAllListeners().unsubscribe(...this.channels);
  }

  @MessagePattern('env.msg', Transport.NATS)
  async handleEnvMessage(msg: ServiceMessage<ServiceMessagePayload>) {
    const { uid, sessionId } = msg.meta || {};

    if (msg.payload.reqAction === 'open') {
      if (!uid) {
        throw new RpcException({ statusCode: 400, message: 'Invalid request, missing uid' });
      }

      try {
        await this.workspaceService.handleEnvOpen(uid, msg.payload as EnvOpenRequest);
      } catch (error: unknown) {
        throw new RpcException({
          statusCode: (error as RpcError).statusCode || 400,
          message: (error as RpcError).message,
        });
      }
      return;
    }

    if (!uid || !sessionId) return;
    await this.workspaceService.handleEnvMessage(uid, sessionId, msg.payload as InSocketMessage<'env'>);
  }
}
