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

import {
  SocketSend,
  SocketBroadcast,
  ServiceEvent,
  UserOffline,
  UserOnline,
  CachedPresence,
  ServiceMessage,
} from 'hide-common';
import { CommonService } from './common.service';
import { FirestoreService } from 'hide-firebase';
import { Firestore } from '@google-cloud/firestore';
import { firstValueFrom, timeout } from 'rxjs';

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
    @Inject('GATEWAY_SERVICE_RMQ') private rmq: ClientProxy,
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
    const newId = socket.id;
    console.log('Previous Id: ', previousId);
    console.log('New Id: ', newId);

    if (previousId) {
      this.server.sockets.sockets.get(previousId)?.conn.close();
    }

    let presence = await this.cache.get<CachedPresence>(`presence:${user.uid}`);
    if (!presence) presence = { sockets: {}, workspaces: {} };

    const wsUuid = presence.sockets[previousId] || 'none';
    presence.sockets[newId] = wsUuid;
    if (wsUuid !== 'none') {
      presence.workspaces[`${newId}:${wsUuid}`] = presence.workspaces[`${previousId}:${wsUuid}`];
    }

    await this.cache.set(`presence:${user.uid}`, presence);
    await this.cache.set(`presence:${user.uid}:${newId}`, wsUuid, 20000);
    if (wsUuid !== 'none') {
      const instanceId = presence.workspaces[wsUuid];
      await this.cache.set(`presence:${user.uid}:${newId}:${wsUuid}`, instanceId, 30000);
    }

    if (Object.keys(presence.sockets).length === 1) {
      this.redis.emit<any, ServiceEvent<UserOnline>>('user.online', { payload: { uid: user.uid } });
    }
  }
  async handleDisconnect(@ConnectedSocket() socket: SocketWithData) {
    console.log('Disconnect: ', socket.id);
    const oldSocketId = socket.id;
    const uid = socket.data.user.uid;
    let presence = await this.cache.get<CachedPresence>(`presence:${uid}`);
    if (!presence) presence = { sockets: {}, workspaces: {} };

    const wsUuid = presence.sockets[oldSocketId];
    if (wsUuid !== 'none') {
      const instanceId = presence.workspaces[`${oldSocketId}:${wsUuid}`];
      this.redis.emit<any, ServiceEvent<InSocketMessage<'internal'>>>(`env.${instanceId}`, {
        payload: {
          action: 'user.disconnect',
          service: 'internal',
          payload: { uid, uuid: wsUuid, socketId: oldSocketId },
        },
      });
      delete presence.workspaces[`${oldSocketId}:${wsUuid}`];
      await this.cache.del(`presence:${uid}:${oldSocketId}:${wsUuid}`);
    }
    delete presence.sockets[oldSocketId];
    await this.cache.del(`presence:${uid}:${oldSocketId}`);

    if (Object.keys(presence.sockets).length === 0) {
      await this.cache.del(`presence:${uid}`);
      this.redis.emit<any, ServiceEvent<UserOffline>>('user.offline', { payload: { uid } });
    } else {
      await this.cache.set(`presence:${uid}`, presence);
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
      if (msg.action === 'workspace.open') {
        msg.payload.socketId = socket.id;
      }
      await this.handleEnvMessage(socket.data.user.uid, socket, msg);
    } else if (msg.service === 'presence') {
      await this.handlePresenceMessage(socket.data.user.uid, socket, msg);
    }
  }

  async handleEnvMessage(uid: string, socket: SocketWithData, msg: InSocketMessage<'env'>) {
    const instanceId = await this.cache.get<string>(`workspace:${msg.payload.uuid}`);
    if (instanceId) {
      let healthy = false;
      try {
        await firstValueFrom(this.redis.send(`env.${instanceId}`, {}).pipe(timeout(1000)));
        healthy = true;
      } catch (error) {
        void error;
      }
      if (!healthy) {
        await this.cache.del(`workspace:${msg.payload.uuid}`);
      }

      // const instanceId = await this.cache.get<string>(`presence:${uid}:${msg.payload.uuid}`);
      /* if (!instanceId) {
        return socket.conn.close();
      } */
      this.redis.emit<any, ServiceEvent<InSocketMessage<'env'>>>(`env.${instanceId}`, {
        payload: msg,
      });
    } else {
      this.rmq.send<any, ServiceMessage<InSocketMessage<'env'>>>('workspace.open', {
        meta: { uid },
        payload: {
          action: 'workspace.open',
          correlationId: msg.correlationId,
          service: 'env',
          payload: { socketId: socket.id, uuid: msg.payload.uuid },
        },
      });
    }
  }
  async handlePresenceMessage(uid: string, socket: SocketWithData, msg: InSocketMessage<'presence'>) {
    if (msg.action === 'ping') {
      msg.payload.uuid = msg.payload.uuid || 'none';
      const presence = await this.cache.get<CachedPresence>(`presence:${uid}`);
      // User not "truly" online
      if (!presence || !presence.sockets[socket.id]) {
        return socket.conn.close();
      }

      const wsUuid = (await this.cache.get<string>(`presence:${uid}:${socket.id}`)) || 'none';
      await this.cache.set(`presence:${uid}:${socket.id}`, wsUuid, 20000);

      // wsUuid mismatch between user and cache, ignore
      if (wsUuid !== msg.payload.uuid) {
        return;
      }

      // No need to process further, no workspace currently active from user
      if (wsUuid === 'none') {
        return;
      }

      const instanceId = await this.cache.get<string>(`presence:${uid}:${socket.id}:${wsUuid}`);

      // wsUuid => instanceId mapping missing
      if (!instanceId) {
        await this.handleSessionLoss(uid, presence, socket.id, wsUuid);
        return;
      }

      // Check if instance is up
      let healthy = false;
      try {
        await firstValueFrom(this.redis.send(`env.${instanceId}`, {}).pipe(timeout(1000)));
        healthy = true;
      } catch (error) {
        void error;
      }

      // Not up = session loss
      if (!healthy) {
        await this.handleSessionLoss(uid, presence, socket.id, wsUuid);
        return;
      }

      // All good
      await this.cache.set(`presence:${uid}:${socket.id}:${wsUuid}`, instanceId, 30000);
    }
  }
  async handleSessionLoss(uid: string, presence: CachedPresence, socketId: string, wsUuid: string) {
    await this.send<'env'>({ uid, pattern: 'env', msg: { action: 'session.lost', payload: {} } });
    presence.sockets[socketId] = 'none';
    delete presence.workspaces[`${socketId}:${wsUuid}`];
    await this.cache.set(`presence:${uid}`, presence);
    await this.cache.set(`presence:${uid}:${socketId}`, 'none', 20000);
    await this.cache.del(`presence:${uid}:${socketId}:${wsUuid}`);
  }
  async handleUserPresenceExpiry(key: string) {
    const [_, uid, socketId, wsUuid] = key.split(':');
    const socket = this.server.sockets.sockets.get(socketId);
    if (!socket) {
      return;
    }

    // Missed ping for opened workspace
    if (wsUuid) {
      const presence = await this.cache.get<CachedPresence>(`presence:${uid}`);

      // Already cleaned-up
      if (!presence || !presence.sockets[socketId] || !presence.workspaces[`${socketId}:${wsUuid}`]) {
        return;
      }

      const instanceId = presence.workspaces[`${socketId}:${wsUuid}`];
      this.redis.emit<any, ServiceEvent<InSocketMessage<'internal'>>>(`env.${instanceId}`, {
        payload: { action: 'user.disconnect', service: 'internal', payload: { uid, uuid: wsUuid, socketId } },
      });
      presence.sockets[socketId] = 'none';
      delete presence.workspaces[`${socketId}:${wsUuid}`];
      await this.cache.set(`presence:${uid}`, presence);
    }
    // Missed ping for socket connection
    else {
      socket.conn.close();
    }
  }

  async send<T extends keyof OutSocketMessageActionMap>(data: SocketSend<T>) {
    const socketId = await this.cache.get<CachedPresence>(`presence:${data.uid}`);
    if (socketId) {
      this.server.to(socketId).emit(data.pattern as any, data.msg);
    }
  }
  async broadcast<T extends keyof OutSocketMessageActionMap>(data: SocketBroadcast<T>) {
    const socketIds = await Promise.all(
      data.uids.map((uid) => this.cache.get<CachedPresence>(`presence:${uid}`)),
    );
    for (const socketId of socketIds) {
      if (socketId) {
        this.server.to(socketId).emit(data.pattern as any, data.msg);
      }
    }
  }
}
