import { randomUUID } from 'node:crypto';
import { Controller, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClientProxy, EventPattern, MessagePattern, RpcException, Transport } from '@nestjs/microservices';
import {
  EnvAffinityRequest,
  EnvCloseRequest,
  EnvOpenRequest,
  HealthCheck,
  InSocketMessage,
  InternalMessage,
  RpcError,
  ServiceEvent,
  ServiceEventPayload,
  ServiceMessage,
  ServiceMessagePayload,
  SocketSend,
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
  channels: string[];

  constructor(
    @Inject('ENV_SERVICE_REDIS') private readonly redis: ClientProxy,
    private readonly cacheService: RedisService,
    private readonly workspaceService: WorkspaceService,
  ) {
    CommonRef.setInstanceId(randomUUID());
    const instanceId = CommonRef.getInstanceId();
    this.cache = this.cacheService.get();
    this.channels = [`env.${instanceId}`, `env.${instanceId}.health`];
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

  @EventPattern('env.internal', Transport.NATS)
  async handleEnvInternalMessage(msg: ServiceEvent<ServiceEventPayload>) {
    if (msg.payload.reqAction === 'affinity') {
      const req = msg.payload as EnvAffinityRequest;
      if (!req.uuid || !req.uid || !req.sessionId) return;

      await this.workspaceService.handleEnvReady(req.uid, req);

      this.redis.emit<any, ServiceEvent<SocketSend<'provision'>>>('socket.send', {
        meta: { uid: req.uid, sessionId: req.sessionId },
        payload: {
          pattern: 'provision',
          uid: req.uid,
          sessionId: req.sessionId,
          msg: { action: 'ready', payload: { message: 'Ready' } },
        },
      });
    }
  }

  @MessagePattern('env.msg', Transport.NATS)
  async handleEnvMessage(msg: ServiceMessage<ServiceMessagePayload>) {
    const { uid, sessionId } = msg.meta || {};

    if (msg.payload.reqAction === 'open') {
      if (!uid) {
        throw new RpcException({ statusCode: 400, message: 'Invalid request, missing uid' });
      }

      try {
        return await this.workspaceService.handleEnvOpen(uid, { uid }, msg.payload as EnvOpenRequest);
      } catch (error: unknown) {
        throw new RpcException({
          statusCode: (error as RpcError).statusCode || 400,
          message: (error as RpcError).message,
        });
      }
    } else if (msg.payload.reqAction === 'close') {
      if (!uid) return { ok: false };
      await this.workspaceService.handleEnvClose(uid, msg.payload as EnvCloseRequest);
      return { ok: true };
    }

    if (!uid || !sessionId) return;
    await this.workspaceService.handleEnvMessage(uid, sessionId, msg.payload as InSocketMessage<'env'>);
  }
}
