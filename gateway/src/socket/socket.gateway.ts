import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { Cache } from '@nestjs/cache-manager';
import { RedisService } from 'hide-redis';
import { User } from 'hide-common/dto/user';
import { Client, ClientChannel } from 'ssh2';
import { ClientProxy } from '@nestjs/microservices';
import {
  InSocketMessage,
  InSocketMessageEnv,
  InSocketMessagePayloadMap,
  OutSocketMessage,
  OutSocketMessageActionMap,
} from 'hide-common/message/socket.message';

import { SocketSend, SocketBroadcast, ServiceEvent, UserOnline, UserOffline } from 'hide-common';
import { SSHProxyService } from './sshproxy.service';
import { CommonService } from './common.service';

export interface ClientEvents {
  ssh: (msg: OutSocketMessage<'ssh'>) => void;
  fs: (msg: OutSocketMessage<'fs'>) => void;
}

export type SocketData = {
  user: User;
  ssh: Record<string, { conn: Client; sessions: Record<string, ClientChannel> }>;
};
export type SocketWithData = Socket<DefaultEventsMap, ClientEvents, DefaultEventsMap, SocketData>;

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN! },
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server<DefaultEventsMap, ClientEvents>;

  private cache: Cache;
  constructor(
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
    private readonly redisService: RedisService,
    private readonly sshService: SSHProxyService,
    private readonly service: CommonService,
  ) {
    this.cache = this.redisService.get();
  }

  async handleConnection(@ConnectedSocket() socket: SocketWithData) {
    const token = socket.handshake.auth?.token as string;
    if (!token) {
      return socket.disconnect();
    }
    const user = await this.handleAuthentication(token);
    if (!user) {
      return socket.disconnect();
    }
    socket.data.user = user;
    socket.data.ssh = {};
    await this.cache.set<string>(`presence:${user.uid}`, socket.id);
    this.redis.emit<any, ServiceEvent<UserOnline>>('user.online', { payload: { uid: user.uid } });
  }
  async handleDisconnect(@ConnectedSocket() socket: Socket) {
    const uid = (socket.data as SocketData)?.user?.uid;
    if (!uid) return;
    this.redis.emit<any, ServiceEvent<UserOffline>>('user.offline', { payload: { uid } });
    await this.cache.del(`presence:${uid}`);
  }
  async handleAuthentication(token: string) {
    try {
      const response = await fetch(`http://auth/api/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new UnauthorizedException('Invalid token');
      }
      return (await response.json()) as User;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  @SubscribeMessage('msg')
  async handleSocketMessage<K extends keyof InSocketMessagePayloadMap>(
    @MessageBody()
    msg: InSocketMessage<K, InSocketMessagePayloadMap[K]>,
    @ConnectedSocket() client: SocketWithData,
  ) {
    if (msg.service === 'env') {
      if (!(await this.service.checkMembership(client.data.user, msg.payload.uuid))) {
        return;
      }

      await this.handleEnvMessage(msg, client);
    }
  }

  async handleEnvMessage(msg: InSocketMessage<'env', InSocketMessageEnv>, client: SocketWithData) {
    let forward = false;
    if (msg.action.startsWith('ssh.')) {
      await this.sshService.handleSSHProxyMessage(msg, client);
    } else if (msg.action.startsWith('fs.')) {
      forward = true;
    } else {
      forward = true;
    }

    if (forward) {
      this.redis.emit<any, ServiceEvent<InSocketMessageEnv>>(`env.${msg.payload.uuid}.${msg.action}`, {
        payload: msg.payload,
      });
    }
  }

  async send<T extends keyof OutSocketMessageActionMap>(data: SocketSend<T>) {
    const socketId = await this.cache.get<string>(`presence:${data.uid}`);
    if (socketId) {
      this.server.to(socketId).emit(data.pattern as any, data.msg);
    }
  }
  async broadcast<T extends keyof OutSocketMessageActionMap>(data: SocketBroadcast<T>) {
    const socketIds = await Promise.all(data.uids.map((uid) => this.cache.get<string>(`presence:${uid}`)));
    for (const socketId of socketIds) {
      if (socketId) {
        this.server.to(socketId).emit(data.pattern as any, data.msg);
      }
    }
  }
}
