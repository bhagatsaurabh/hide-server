import { promises as fs } from 'node:fs';
import { Controller, Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClientRedis, MessagePattern, Payload, Transport } from '@nestjs/microservices';
import {
  EnvPingEvent,
  FSCloseRequest,
  FSDocSyncEvent,
  FSExtEvent,
  FSOpenRequest,
  FSSaveRequest,
  Message,
} from 'src/common/message';
import { FSService } from './fs.service';
import { SyncService } from './sync.service';
import Redis from 'ioredis';

@Controller('api')
export class GatewayController implements OnModuleInit, OnModuleDestroy {
  root = '/home/devuser/workspace';
  uuid = process.env.WS_UUID!;
  redisServer: [Redis, Redis];
  channels = [
    `env.${this.uuid}.ping`,
    `env.${this.uuid}.fs.watch`,
    `env.${this.uuid}.fs.sync`,
    `env.${this.uuid}.fs.save`,
  ];

  constructor(
    private readonly fsService: FSService,
    private readonly syncService: SyncService,
    @Inject('REDIS_CLIENT') private readonly redis: ClientRedis,
  ) {}

  async onModuleInit() {
    this.redis.

    /* const [pub, sub] = RedisRef.get();
    this.redisServer = [pub, sub];

    for (const channel of this.channels) {
      await sub.subscribe(channel);
      sub.on('message', (chan, message) => {
        const parsed = JSON.parse(message) as unknown;
        switch (chan) {
          case `env.${this.uuid}.ping`: {
            this.handleHeartbeat(parsed as Message<EnvPingEvent>);
            break;
          }
          case `env.${this.uuid}.fs.watch`: {
            this.handleWatchEvent(parsed as FSExtEvent);
            break;
          }
          case `env.${this.uuid}.fs.sync`: {
            this.handleSyncEvent(parsed as Message<FSDocSyncEvent>);
            break;
          }
          case `env.${this.uuid}.fs.save`: {
            void this.handleSaveEvent(parsed as Message<FSSaveRequest>);
            break;
          }
          default:
            break;
        }
      });
    } */
  }
  async onModuleDestroy() {
    await this.redisServer[1].removeAllListeners().unsubscribe(...this.channels);
  }

  handleHeartbeat(msg: Message<EnvPingEvent>) {
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
  }

  // TODO
  @MessagePattern(`env.shutdown`, Transport.RMQ)
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
  }
}
