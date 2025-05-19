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
  OutSocketMessage,
  OutSocketMessageActionMap,
} from 'hide-common/message/socket.message';

import { SocketSend, SocketBroadcast, ServiceEvent, UserOnline, UserOffline } from 'hide-common';
import { CommonService } from './common.service';
import { FirestoreService } from 'hide-firebase';
import { Firestore } from '@google-cloud/firestore';

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
  private db: Firestore;

  constructor(
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('GATEWAY_SERVICE_RMQ') private readonly rmq: ClientProxy,
    private readonly redisService: RedisService,
    private readonly firestore: FirestoreService,
    private readonly service: CommonService,
  ) {
    this.cache = this.redisService.get();
    this.db = this.firestore.db;
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

      const user = (await response.json()) as User;

      let isProfileCreated = await this.cache.get<boolean>(`profile:${user.uid}`);
      if (isProfileCreated === null) {
        const profileSnap = await this.db.collection('users').where('uid', '==', user.uid).get();
        isProfileCreated = profileSnap.docs.length > 0;
        await this.cache.set(`profile:${user.uid}`, isProfileCreated);
      }

      return user;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  @SubscribeMessage('msg')
  async handleSocketMessage(@MessageBody() msg: InSocketMessage, @ConnectedSocket() client: SocketWithData) {
    if (msg.service === 'env') {
      if (!(await this.service.checkMembership(client.data.user, msg.payload.uuid))) {
        return;
      }

      await this.handleEnvMessage(client.data.user.uid, msg);
    }
  }

  async handleEnvMessage(uid: string, msg: InSocketMessage<'env'>) {
    const instanceId = await this.cache.get<string>(`workspace:${uid}`);
    if (!instanceId) {
      return;
    }

    this.redis.emit<any, ServiceEvent<InSocketMessage<'env'>>>(`env.${instanceId}`, {
      payload: msg,
    });
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
