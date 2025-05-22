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

  /* root = '/home/devuser/workspace';
  uuid = process.env.WS_UUID!;
  channels = [
    `env.${this.uuid}.ping`,
    `env.${this.uuid}.fs.watch`,
    `env.${this.uuid}.fs.sync`,
    `env.${this.uuid}.fs.save`,
  ]; */

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

    await sub.subscribe(`env.${this.instanceId}`);
    sub.on('message', (_chan, message) => {
      const parsed = JSON.parse(message) as ServiceEvent<InSocketMessage<'env' | 'internal'>>;
      if (!parsed.meta?.uid) return;

      switch (parsed.payload.action) {
        case 'workspace.open': {
          void this.workspaceService.handleWorkspaceOpen(
            parsed.meta.uid,
            parsed.payload.payload,
            parsed.payload.correlationId,
          );
          break;
        }
        case 'ssh.request': {
          this.sshService.handleRequest(parsed.meta.uid, parsed.payload.payload);
          break;
        }
        case 'ssh.data': {
          this.sshService.handleSSHData(parsed.meta.uid, parsed.payload.payload);
          break;
        }
        case 'ssh.close': {
          this.sshService.handleSSHClose(parsed.meta.uid, parsed.payload.payload);
          break;
        }
        case 'ssh.closeall': {
          this.sshService.handleSSHCloseAll(parsed.meta.uid, parsed.payload.payload);
          break;
        }
        case 'user.disconnect': {
          // TODO
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

  /* handleHeartbeat(msg: Message<EnvPingEvent>) {
    this.fsService.handleHeartbeat(msg.meta.uid);
  }
  handleWatchEvent(event: FSExtEvent) {
    this.fsService.handleEvent(event);
  }
  handleSyncEvent(msg: Message<FSDocSyncEvent>) {
    this.syncService.handleFSUpdate(msg);
  }
  async handleSaveEvent(msg: Message<FSSaveRequest>) {
    await this.syncService.handleFSSave(msg);
  } */

  // TODO
  /* @MessagePattern(`env.shutdown`, Transport.RMQ)
  shutdown() {
    this.fsService.dispose();
  }
  @MessagePattern('env.fs.open', Transport.REDIS)
  async fsOpen(@Payload() msg: Message<FSOpenRequest>) {
    const path = this.root + msg.payload.path;
    try {
      const stat = await fs.stat(path);
      if (stat.isDirectory()) {
        return await this.fsService.openDir(msg.meta.uid, path);
      }
      return this.syncService.openFile(msg.meta.uid, path);
    } catch (err) {
      console.log(err);
      return [];
    }
  }
  @MessagePattern('env.fs.close', Transport.REDIS)
  async fsClose(@Payload() msg: Message<FSCloseRequest>) {
    const path = this.root + msg.payload.path;
    try {
      const stat = await fs.stat(path);
      if (stat.isDirectory()) {
        return this.fsService.closeDir(msg.meta.uid, path);
      }
      return this.syncService.closeFile(msg.meta.uid, path);
    } catch (err) {
      console.log(err);
      return;
    }
  } */
}
