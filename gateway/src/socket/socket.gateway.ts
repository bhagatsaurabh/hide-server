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
import { ClientProxy } from '@nestjs/microservices';
import {
  InSocketMessage,
  InSocketMessagePayloadMap,
  OutSocketMessage,
  OutSocketMessageActionMap,
} from 'hide-common/message/socket.message';

import { SocketSend, SocketBroadcast, ServiceEvent, UserOffline, UserOnline } from 'hide-common';
import { CommonService } from './common.service';
import { FirestoreService } from 'hide-firebase';
import { Firestore } from '@google-cloud/firestore';

export interface ClientEvents {
  ssh: (msg: OutSocketMessage<'ssh'>) => void;
  fs: (msg: OutSocketMessage<'fs'>) => void;
}

export type SocketData = {
  user: User;
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
    const previousId = socket.handshake.auth.previousId as string;
    console.log('Previous Id: ', previousId);
    console.log('New Id: ', socket.id);

    if (previousId) {
      this.server.sockets.sockets.get(previousId)?.conn.close();
    }

    const socketIds = new Set(await this.cache.get<string[]>(`presence:${user.uid}`));
    socketIds.add(socket.id);
    await this.cache.set(`presence:${user.uid}`, Array.from(socketIds));
    await this.cache.set(`presence:${user.uid}:${socket.id}`, 'none', 20000);

    if (socketIds.size === 1) {
      this.redis.emit<any, ServiceEvent<UserOnline>>('user.online', { payload: { uid: user.uid } });
    }
  }
  async handleDisconnect(@ConnectedSocket() socket: SocketWithData) {
    console.log('Disconnect: ', socket.id);
    const oldSocketId = socket.id;
    const uid = socket.data.user.uid;
    const socketIds = new Set(await this.cache.get<string[]>(`presence:${uid}`));
    const workspaceUuid = await this.cache.get<string>(`presence:${uid}:${oldSocketId}`);
    if (workspaceUuid) {
      const instanceId = await this.cache.get<string>(`presence:${uid}:${workspaceUuid}`);
      this.redis.emit<any, ServiceEvent<InSocketMessage<'internal'>>>(`env.${instanceId}`, {
        payload: { action: 'user.disconnect', service: 'internal', payload: { uid, uuid: workspaceUuid } },
      });
      await this.cache.del(`presence:${uid}:${workspaceUuid}`);
    }
    await this.cache.del(`presence:${uid}:${oldSocketId}`);

    socketIds.delete(oldSocketId);
    if (socketIds.size === 0) {
      await this.cache.del(`presence:${uid}`);
      this.redis.emit<any, ServiceEvent<UserOffline>>('user.offline', { payload: { uid } });
    } else {
      await this.cache.set(`presence:${uid}`, Array.from(socketIds));
    }
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
  async handleSocketMessage(
    @MessageBody() msg: InSocketMessage<Exclude<keyof InSocketMessagePayloadMap, 'internal'>>,
    @ConnectedSocket() socket: SocketWithData,
  ) {
    if (!(await this.service.checkMembership(socket.data.user, msg.payload.uuid))) {
      return;
    }

    if (msg.service === 'env') {
      await this.handleEnvMessage(socket.data.user.uid, socket, msg);
    } else if (msg.service === 'presence') {
      await this.handlePresenceMessage(socket.data.user.uid, socket, msg);
    }
  }

  async handleEnvMessage(uid: string, socket: SocketWithData, msg: InSocketMessage<'env'>) {
    const instanceId = await this.cache.get<string>(`presence:${uid}:${msg.payload.uuid}`);
    if (!instanceId) {
      return socket.conn.close();
    }

    this.redis.emit<any, ServiceEvent<InSocketMessage<'env'>>>(`env.${instanceId}`, {
      payload: msg,
    });
  }
  async handlePresenceMessage(uid: string, socket: SocketWithData, msg: InSocketMessage<'presence'>) {
    if (msg.action === 'ping') {
      const workspaceUuid = await this.cache.get<string>(`presence:${uid}:${socket.id}`);
      if (!workspaceUuid) {
        return socket.conn.close();
      }

      await this.cache.set(`presence:${uid}:${socket.id}`, workspaceUuid, 20000);
    }
  }
  handleUserPresenceExpiry(key: string) {
    const [_, _uid, socketId] = key.split(':');
    this.server.sockets.sockets.get(socketId)?.conn.close();
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
