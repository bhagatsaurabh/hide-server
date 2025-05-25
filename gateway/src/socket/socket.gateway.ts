import { Inject, Injectable, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
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
  CachedPresence,
  ServiceMessage,
  GatewayPayload,
  CachedSession,
  CachedWorkspace,
} from 'hide-common';
import { CommonService } from './common.service';
import { FirestoreService } from 'hide-firebase';
import { getHashedKey } from 'hide-common/utils';
import { Firestore } from '@google-cloud/firestore';
import { firstValueFrom, timeout } from 'rxjs';
import { CommonRef } from 'src/common/refs/common.ref';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { RedisRef } from 'src/common/refs/redis.ref';
import Redlock from 'redlock';

export interface ClientEvents {
  ssh: (msg: OutSocketMessage<'ssh'>) => void;
  fs: (msg: OutSocketMessage<'fs'>) => void;
}

export type SocketData = {
  user: User;
  sessionId: string;
};
export type TypedSocket = Socket<DefaultEventsMap, ClientEvents, DefaultEventsMap, SocketData>;

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN! },
})
@Injectable()
export class SocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private server: Server<DefaultEventsMap, ClientEvents, DefaultEventsMap, SocketData>;
  private instanceId: string;
  private cache: Cache;
  private db: Firestore;
  private redisClients: [Redis, Redis];
  private lockClient: Redis;
  private allowConnections = true;

  constructor(
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('GATEWAY_SERVICE_RMQ') private rmq: ClientProxy,
    @Inject('GATEWAY_SERVICE_NATS') private nats: ClientProxy,
    private readonly redisService: RedisService,
    private readonly firestore: FirestoreService,
    private readonly service: CommonService,
  ) {
    this.cache = this.redisService.get();
    this.db = this.firestore.db;
    this.redisClients = RedisRef.get();
    this.lockClient = new Redis(parseInt(process.env.REDIS_PORT!), process.env.REDIS_HOST!);
  }

  async onModuleInit() {
    CommonRef.setInstanceId(randomUUID());
    this.instanceId = CommonRef.getInstanceId();
    await this.setupInstanceListener();
  }
  async onModuleDestroy() {
    this.allowConnections = false;

    await this.redisClients[1].removeAllListeners().unsubscribe(`gateway.${this.instanceId}`);
    for (const socket of this.server.sockets.sockets.values()) {
      socket.client.conn.close();
    }
  }

  async setupInstanceListener() {
    const sub = this.redisClients[1];
    const channel = `gateway.${this.instanceId}`;
    await sub.subscribe(channel);

    sub.on('message', (chan, message) => {
      if (chan !== channel) return;

      const parsed = JSON.parse(message) as ServiceEvent<GatewayPayload>;
      if (!parsed.meta?.uid) return;

      switch (parsed.payload.action) {
        case 'socket.close': {
          this.server.sockets.sockets.get(parsed.payload.payload.socketId)?.conn.close();
          break;
        }
        default:
          break;
      }
    });
  }

  async handleConnection(@ConnectedSocket() socket: TypedSocket) {
    if (!this.allowConnections) {
      return socket.client.conn.close();
    }

    const token = socket.handshake.auth?.token as string;
    if (!token) {
      return socket.disconnect();
    }
    const user = await this.handleAuthentication(token);
    if (!user) {
      return socket.disconnect();
    }

    const sessionId = socket.handshake.auth.sessionId as string;
    const uid = user.uid;
    const lock = await this.acquireLock([this.lockClient], `${uid}:${sessionId}`, 10 * 1000, 5);
    socket.data.user = user;
    socket.data.sessionId = sessionId;

    const newSocketId = socket.id;
    let presence = await this.cache.get<CachedPresence>(`presence:${uid}`);
    if (!presence) presence = {};
    const { socketId: oldSocketId, gatewayId: oldGatewayId, wsUuid } = presence[sessionId];
    presence[sessionId] = { socketId: newSocketId, gatewayId: this.instanceId, wsUuid, state: 'active' };

    // Existing Session, re-connection
    if (oldSocketId && oldGatewayId) {
      this.redis.emit<any, ServiceEvent<GatewayPayload>>(`gateway.${oldGatewayId}`, {
        payload: { action: 'socket.close', payload: { socketId: oldSocketId } },
      });
    }

    await this.cache.set<CachedPresence>(`presence:${uid}`, presence);
    await this.cache.set(`presence:${uid}:${sessionId}`, 1, 20000);
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
    if (workspace) {
      workspace.state = 'active';
      await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
      await this.cache.set(`presence:${uid}:${sessionId}:${wsUuid}`, 1, 20000);
    }
    await lock.release();
  }
  async handleDisconnect(@ConnectedSocket() socket: TypedSocket) {
    const uid = socket.data.user.uid;
    const sessionId = socket.data.sessionId;
    const lock = await this.acquireLock([this.lockClient], `${uid}:${sessionId}`, 10 * 1000, 5);
    let presence = await this.cache.get<CachedPresence>(`presence:${uid}`);
    if (!presence) presence = {};
    const { wsUuid } = presence[sessionId];

    presence[sessionId].state = 'inactive';
    await this.cache.set(`presence:${uid}`, presence);
    await this.cache.set(`presence:${uid}:${sessionId}`, 0, 360000);

    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
    if (workspace) {
      workspace.state = 'inactive';
      await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
      await this.cache.set(`presence:${uid}:${sessionId}:${wsUuid}`, 0, 300000);
    }

    await lock.release();
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

  async acquireLock(clients: Redis[], key: string, duration: number, retryCount: number) {
    const redlock = new Redlock(clients, { retryCount, retryDelay: 400, retryJitter: 200 });
    return await redlock.acquire([`locks:${key}`], duration);
  }

  @SubscribeMessage('msg')
  async handleSocketMessage(
    @MessageBody() msg: InSocketMessage<Exclude<keyof InSocketMessagePayloadMap, 'internal'>>,
    @ConnectedSocket() socket: TypedSocket,
  ) {
    const uid = socket.data.user.uid;
    const sessionId = socket.data.sessionId;
    const presence = await this.cache.get<CachedPresence>(`presence:${uid}`);
    if (!presence || !presence[sessionId]) {
      return socket.client.conn.close();
    }

    if (msg.service === 'env') {
      await this.handleEnvMessage(uid, sessionId, msg);
    } else if (msg.service === 'presence') {
      await this.handlePresenceMessage(uid, sessionId, presence, msg);
    }
  }

  async handleEnvMessage(uid: string, sessionId: string, msg: InSocketMessage<'env'>) {
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${msg.payload.uuid}`);
    if (!workspace) return;
    const isAuthZ = await this.service.checkMembership(uid, msg.payload.uuid);
    if (!isAuthZ) return;

    // Sticky route
    if (msg.action === 'fs.sync' || msg.action === 'fs.save') {
      const envInstanceId = workspace.docs[msg.payload.path];

      let healthy = false;
      try {
        await firstValueFrom(this.redis.send(`env.${envInstanceId}`, {}).pipe(timeout(1000)));
        healthy = true;
      } catch (error) {
        void error;
      }

      if (!healthy) {
        delete workspace.docs[msg.payload.path];
        await this.cache.set<CachedWorkspace>(`workspace:${msg.payload.uuid}`, workspace);
        await this.send({
          uid,
          pattern: 'fs',
          msg: { action: 'lost', payload: { path: msg.payload.path } },
        });
      } else {
        this.redis.emit<any, ServiceEvent<InSocketMessage<'env'>>>(`env.${envInstanceId}`, {
          payload: msg,
        });
      }
    } else {
      this.nats.send<any, ServiceMessage<InSocketMessage<'env'>>>('env.msg', {
        meta: { uid },
        payload: msg,
      });
    }
  }
  async handlePresenceMessage(
    uid: string,
    sessionId: string,
    presence: CachedPresence,
    msg: InSocketMessage<'presence'>,
  ) {
    if (msg.action === 'session.ping') {
      presence[sessionId].state = 'active';
      await this.cache.set<CachedPresence>(`presence:${uid}`, presence);
      await this.cache.set(`presence:${uid}:${sessionId}`, 1, 20000);

      const { wsUuid } = presence[sessionId];
      const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
      if (
        wsUuid &&
        workspace &&
        wsUuid === msg.payload.uuid &&
        (await this.service.checkMembership(uid, msg.payload.uuid))
      ) {
        workspace.state = 'active';
        await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
        await this.cache.set(`presence:${uid}:${sessionId}:${wsUuid}`, 1, 20000);
      }
    }
  }
  /* async handleSessionLoss(uid: string, presence: CachedPresence, socketId: string, wsUuid: string) {
    await this.send<'env'>({ uid, pattern: 'env', msg: { action: 'session.lost', payload: {} } });
    presence.sockets[socketId] = 'none';
    delete presence.workspaces[`${socketId}:${wsUuid}`];
    await this.cache.set(`presence:${uid}`, presence);
    await this.cache.set(`presence:${uid}:${socketId}`, 'none', 20000);
    await this.cache.del(`presence:${uid}:${socketId}:${wsUuid}`);
  } */
  async handleUserPresenceExpiry(key: string) {
    const lock = await this.acquireLock([this.lockClient], key, 10 * 1000, 2);

    const [type, ...parts] = key.split(':');
    if (type === 'presence') {
      const [uid, sessionId, wsUuid] = parts;
      if (wsUuid) {
        const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
        if (!workspace) return;
        if (workspace.state === 'active') {
          workspace.state = 'inactive';
          await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
          await this.cache.set(`presence:${uid}:${sessionId}:${wsUuid}`, 0, 300000);
        } else {
          // TODO: Workspace expired, cleanup ?
        }
      } else {
        const presence = await this.cache.get<CachedPresence>(`presence:${uid}:${sessionId}`);
        if (!presence) return;
        if (presence[sessionId].state === 'active') {
          presence[sessionId].state = 'inactive';
          await this.cache.set<CachedPresence>(`presence:${uid}:${sessionId}`, presence);
          await this.cache.set(`presence:${uid}:${sessionId}`, 0, 400000);
        } else {
          // TODO: Session expired, cleanup ?
        }
      }
    }

    await lock.release();
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
