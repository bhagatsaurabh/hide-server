import { randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  Inject,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { InSocketMessage, MembershipCheck, ServiceEvent, ServiceMessage, UserHeader } from 'hide-common';
import { User } from 'hide-common/model/user';
import Redis from 'ioredis';
import { RedisRef } from 'src/common/refs/redis.ref';
import { SSHProxyService } from './sshproxy.service';
import { Cache } from '@nestjs/cache-manager';
import { RedisService } from 'hide-redis';

@Controller('api')
export class CoreController implements OnModuleInit, OnModuleDestroy {
  instanceId: string;
  redisServer: [Redis, Redis];
  cache: Cache;

  /* root = '/home/devuser/workspace';
  uuid = process.env.WS_UUID!;
  channels = [
    `env.${this.uuid}.ping`,
    `env.${this.uuid}.fs.watch`,
    `env.${this.uuid}.fs.sync`,
    `env.${this.uuid}.fs.save`,
  ]; */

  constructor(
    @Inject('ENV_SERVICE_RMQ') private readonly rmq: ClientProxy,
    private readonly sshService: SSHProxyService,
    private readonly cacheService: RedisService,
  ) {
    this.instanceId = randomUUID();
    this.cache = this.cacheService.get();
  }

  async onModuleInit() {
    this.redisServer = RedisRef.get();
    const sub = this.redisServer[1];

    await sub.subscribe(`env.${this.instanceId}`);
    sub.on('message', (_chan, message) => {
      const parsed = JSON.parse(message) as ServiceEvent<InSocketMessage<'env'>>;
      if (!parsed.meta?.uid) return;

      switch (parsed.payload.action) {
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
        default:
          break;
      }
    });
  }
  async onModuleDestroy() {
    await this.redisServer[1].removeAllListeners().unsubscribe(`env.${this.instanceId}`);
  }

  @Get(':workspaceUuid')
  async openWorkspace(@UserHeader() user: User, @Param('workspaceUuid') workspaceUuid: string) {
    const observable = this.rmq.send<boolean, ServiceMessage<MembershipCheck>>('workspace.membership.check', {
      payload: { uid: user.uid, uuid: workspaceUuid },
    });
    if (!(await firstValueFrom(observable))) {
      throw new UnauthorizedException('Not a member of workspace');
    }

    await this.cache.set(`workspace:${user.uid}`, this.instanceId);
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
