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
  CachedWorkspace,
  HealthCheck,
} from 'hide-common';
import { FirestoreService } from 'hide-firebase';
import { Firestore } from '@google-cloud/firestore';
import { firstValueFrom, timeout } from 'rxjs';
import { CommonRef } from 'src/common/refs/common.ref';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { RedisRef } from 'src/common/refs/redis.ref';
import Redlock from 'redlock';
import { MembershipService } from './membership.service';
import { PresenceService } from './presence.service';

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
    @Inject('GATEWAY_SERVICE_NATS') private nats: ClientProxy,
    @Inject('GATEWAY_SERVICE_RMQ') private rmq: ClientProxy,
    private readonly redisService: RedisService,
    private readonly firestore: FirestoreService,
    private readonly membershipService: MembershipService,
    private readonly presenceService: PresenceService,
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

    await this.presenceService.setSessionState(presence, uid, sessionId, 'active');
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
    if (workspace) {
      await this.presenceService.setWorkspaceState(workspace, uid, sessionId, wsUuid, 'active');
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

    await this.presenceService.setSessionState(presence, uid, sessionId, 'inactive');
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
    if (workspace) {
      await this.presenceService.setWorkspaceState(workspace, uid, sessionId, wsUuid, 'inactive');
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
      await this.presenceService.handlePresenceMessage(uid, sessionId, presence, msg);
    }
  }

  stickyActions = ['fs.sync', 'ssh.data', 'ssh.close'];
  async handleEnvMessage(uid: string, sessionId: string, msg: InSocketMessage<'env'>) {
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${msg.payload.uuid}`);
    if (!workspace) return;
    const isAuthZ = await this.membershipService.checkMembership(uid, msg.payload.uuid);
    if (!isAuthZ) {
      await this.send({
        uid,
        sessionId,
        pattern: 'env',
        msg: { action: 'error', payload: { correlationId: msg.correlationId, code: 'NOT_A_MEMBER' } },
      });
      return;
    }

    // Sticky route
    if (this.stickyActions.includes(msg.action)) {
      let envInstanceId: string;
      if (msg.action === 'fs.sync') {
        envInstanceId = workspace.docs[msg.payload.path];
      } else {
        envInstanceId = workspace.sshs[sessionId];
      }

      let healthy = false;
      try {
        await firstValueFrom(
          this.redis
            .send<any, ServiceEvent<HealthCheck>>(`env.${envInstanceId}.health`, { payload: {} })
            .pipe(timeout(500)),
        );
        healthy = true;
      } catch (error) {
        void error;
      }

      if (!healthy) {
        if (msg.action === 'fs.sync') {
          await this.handleFSLoss(workspace, uid, sessionId, msg.payload.uuid, msg.payload.path);
        } else {
          await this.handleSSHSLoss(
            workspace,
            uid,
            sessionId,
            msg.payload.uuid,
            msg.payload.sshSessionId as string,
          );
        }
      } else {
        this.redis.emit<any, ServiceEvent<InSocketMessage<'env'>>>(`env.${envInstanceId}`, {
          payload: msg,
        });
      }
    } else {
      this.nats.send<any, ServiceMessage<InSocketMessage<'env'>>>('env.msg', {
        meta: { uid, sessionId },
        payload: msg,
      });
    }
  }
  async handleFSLoss(
    workspace: CachedWorkspace,
    uid: string,
    sessionId: string,
    wsUuid: string,
    path: string,
  ) {
    delete workspace.docs[path];
    await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
    await this.send({
      uid,
      sessionId,
      pattern: 'fs',
      msg: { action: 'lost', payload: { path: path } },
    });
  }
  async handleSSHSLoss(
    workspace: CachedWorkspace,
    uid: string,
    sessionId: string,
    wsUuid: string,
    sshSessionId: string,
  ) {
    delete workspace.sshs[sessionId];
    await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
    await this.send({
      uid,
      sessionId,
      pattern: 'ssh',
      msg: { action: 'closed', payload: { sshSessionId, all: true } },
    });
  }

  async handleCacheExpiry(key: string) {
    const lock = await this.acquireLock([this.lockClient], key, 10 * 1000, 0);

    const [type, ...parts] = key.split(':');
    if (type === 'presence') {
      await this.presenceService.handlePresenceExpiry(parts);
    }

    await lock.release();
  }

  async send<T extends keyof OutSocketMessageActionMap>(data: SocketSend<T>) {
    const presence = await this.cache.get<CachedPresence>(`presence:${data.uid}`);
    const socketId = presence?.[data.sessionId]?.socketId;
    if (socketId) {
      this.server.to(socketId).emit(data.pattern as any, data.msg);
    }
  }
  async broadcast<T extends keyof OutSocketMessageActionMap>(data: SocketBroadcast<T>) {
    const presenceAll = await Promise.all(
      data.uids.map((uid) => this.cache.get<CachedPresence>(`presence:${uid}`)),
    );
    const socketIds = presenceAll.map((presence, idx) => presence?.[data.sessionIds[idx]].socketId);
    for (const socketId of socketIds) {
      if (socketId) {
        this.server.to(socketId)?.emit(data.pattern as any, data.msg);
      }
    }
  }
}
