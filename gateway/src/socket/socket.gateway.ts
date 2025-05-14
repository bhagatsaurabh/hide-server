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
  InSocketMessagePayloadMap,
  SocketMessagePayload,
} from 'hide-common/message/socket.message';

import { EventsMap } from 'socket.io/dist/typed-events';
import { FSMessage, EnvMessage, SocketSend, SocketBroadcast } from 'hide-common';
import { createMessage } from 'src/utils';
import { SSHProxyService } from './sshproxy.service';
import { CommonService } from './common.service';

export type SocketData = {
  user: User;
  ssh: Record<string, { conn: Client; sessions: Record<string, ClientChannel> }>;
};
export type SocketWithData = Socket<DefaultEventsMap, EventsMap, DefaultEventsMap, SocketData>;

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN! },
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server;

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
    this.redis.emit('user-online', user.uid);
  }
  async handleDisconnect(@ConnectedSocket() socket: Socket) {
    const uid = (socket.data as SocketData)?.user?.uid;
    if (!uid) return;
    this.redis.emit('user-offline', uid);
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
  async handleSocketMessage(
    @MessageBody() msg: InSocketMessage<keyof InSocketMessagePayloadMap, any>,
    @ConnectedSocket() client: SocketWithData,
  ) {
    if (msg.service === 'env') {
      await this.handleEnvMessage(msg, client);
    }
  }

  async handleEnvMessage(msg: InSocketMessage<'env', any>, client: SocketWithData) {
    if (msg.action.startsWith('ssh.')) {
      await this.sshService.handleSSHProxyMessage(msg, client);
    } else if (msg.action.startsWith('fs.')) {
      // TODO
    } else {
      // TODO
    }
  }

  @SubscribeMessage('fs')
  handleFSMessage<T extends SocketMessagePayload>(
    @MessageBody() data: FSMessage<T>,
    @ConnectedSocket() client: SocketWithData,
  ) {
    const msg = createMessage<T>(client.data.user.uid, '', data.payload);
    this.redis.emit(`fs:${data.action}`, msg);
  }
  @SubscribeMessage('env')
  async handleEnvMessage1(@MessageBody() data: EnvMessage, @ConnectedSocket() client: SocketWithData) {
    if (!(await this.service.checkMembership(client.data.user, data.payload.uuid))) {
      return;
    }

    const msg = createMessage(client.data.user.uid, '', data.payload);
    this.redis.emit(`fs:${data.action}`, msg);
  }

  async send<T extends SocketMessagePayload>(data: SocketSend<T>) {
    const socketId = await this.cache.get<string>(`presence:${data.uid}`);
    if (socketId) {
      this.server.to(socketId).emit(data.pattern, data.msg);
    }
  }
  async broadcast<T extends SocketMessagePayload>(data: SocketBroadcast<T>) {
    const socketIds = await Promise.all(data.uids.map((uid) => this.cache.get<string>(`presence:${uid}`)));
    for (const socketId of socketIds) {
      if (socketId) {
        this.server.to(socketId).emit(data.pattern, data.msg);
      }
    }
  }
}
