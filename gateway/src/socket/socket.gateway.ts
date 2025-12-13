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
import { User as UserModel } from 'hide-common/model/user';
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
  CACHEKEY_PRESENCE,
  CachedSession,
  CACHEKEY_USER_PROFILE,
  logger,
} from 'hide-common';
import { FirestoreService } from 'hide-firebase';
import { firstValueFrom, timeout } from 'rxjs';
import { CommonRef } from 'src/common/refs/common.ref';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { RedisRef } from 'src/common/refs/redis.ref';
import Redlock from 'redlock';
import { MembershipService } from './membership.service';
import { PresenceService } from './presence.service';
import { userConverter } from 'hide-common';
import { firestore } from 'firebase-admin';

export type ClientEvents = {
  ssh: (msg: OutSocketMessage<'ssh'>) => void;
  fs: (msg: OutSocketMessage<'fs'>) => void;
} & {
  [key: string]: (msg: OutSocketMessage<string>) => void;
};

export type SocketData = {
  user: User;
  sessionId: string;
};
export type TypedSocket = Socket<DefaultEventsMap, ClientEvents, DefaultEventsMap, SocketData>;

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || '*' },
  transports: ['polling', 'websocket'],
})
@Injectable()
export class SocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private server: Server<DefaultEventsMap, ClientEvents, DefaultEventsMap, SocketData>;
  private cache: Cache;
  private db: firestore.Firestore;
  private redisClients: [Redis, Redis];
  private lockClient: Redis;
  private allowConnections = true;

  constructor(
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('GATEWAY_SERVICE_NATS') private nats: ClientProxy,
    @Inject('GATEWAY_SERVICE_RMQ') private _rmq: ClientProxy,
    private readonly redisService: RedisService,
    private readonly firestore: FirestoreService,
    private readonly membershipService: MembershipService,
    private readonly presenceService: PresenceService,
  ) {
    this.cache = this.redisService.get();
    this.db = this.firestore.db;
    this.lockClient = new Redis(parseInt(process.env.REDIS_PORT!), process.env.REDIS_HOST!);
  }

  async onModuleInit() {
    CommonRef.setInstanceId(randomUUID());
    console.log('Instance: ', CommonRef.getInstanceId());
    this.redisClients = RedisRef.get();
    await this.setupInstanceListener();
  }
  async onModuleDestroy() {
    this.allowConnections = false;

    await this.redisClients[1].removeAllListeners().unsubscribe(`gateway.${CommonRef.getInstanceId()}`);
    for (const socket of this.server.sockets.sockets.values()) {
      socket.client.conn.close();
    }
  }
  async setupInstanceListener() {
    const sub = this.redisClients[1];
    const channel = `gateway.${CommonRef.getInstanceId()}`;
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
    let presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (!presence) presence = {};
    if (!presence[sessionId]) presence[sessionId] = {} as CachedSession;
    const { socketId: oldSocketId, gatewayId: oldGatewayId, wsUuid } = presence[sessionId];
    presence[sessionId] = {
      socketId: newSocketId,
      gatewayId: CommonRef.getInstanceId(),
      wsUuid,
      state: 'active',
    };

    // Existing Session, re-connection
    if (oldSocketId && oldGatewayId) {
      try {
        this.redis.emit<any, ServiceEvent<GatewayPayload>>(`gateway.${oldGatewayId}`, {
          payload: { action: 'socket.close', payload: { socketId: oldSocketId } },
        });
      } catch (error) {
        console.log(error);
      }
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
    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (!presence || !presence[sessionId]) return;

    await this.presenceService.setSessionState(presence, uid, sessionId, 'inactive');
    const { wsUuid } = presence[sessionId];
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

      let userProfile = await this.cache.get<UserModel>(CACHEKEY_USER_PROFILE(user.uid));
      if (!userProfile) {
        const profileSnap = await this.db
          .collection('users')
          .withConverter(userConverter(this.firestore.Timestamp))
          .where('uid', '==', user.uid)
          .get();
        userProfile = profileSnap.docs.length > 0 ? profileSnap.docs[0].data() : undefined;
        if (userProfile) {
          await this.cache.set(CACHEKEY_USER_PROFILE(user.uid), userProfile);
        }
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
    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (!presence || !presence[sessionId]) {
      if (msg.correlationId) {
        socket.emit(msg.correlationId, { action: 'error', payload: { error: { code: 'NO_SESSION' } } });
      }
      return socket.client.conn.close();
    }

    if (msg.service === 'env') {
      await this.handleEnvMessage(socket, uid, sessionId, msg);
    } else if (msg.service === 'presence') {
      const awareness = await this.presenceService.handlePresenceMessage(uid, sessionId, presence, msg);
      if (awareness) {
        void this.send<'env'>({
          pattern: 'env',
          uid,
          sessionId,
          msg: { action: 'awareness', payload: { uids: awareness } },
        });
      }
    }
  }

  stickyActions = ['fs.sync', 'ssh.data', 'ssh.close', 'fs.open.ack', 'fs.conflict.resolve', 'ws.run'];
  async handleEnvMessage(socket: TypedSocket, uid: string, sessionId: string, msg: InSocketMessage<'env'>) {
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${msg.payload.uuid}`);
    if (!workspace) {
      if (msg.correlationId) {
        socket.emit(msg.correlationId, { action: 'error', payload: { error: { code: 'NO_WORKSPACE' } } });
      }
      return;
    }
    const isAuthZ = await this.membershipService.checkMembership(uid, msg.payload.uuid);
    if (!isAuthZ) {
      if (msg.correlationId) {
        socket.emit(msg.correlationId, { action: 'error', payload: { error: { code: 'NOT_A_MEMBER' } } });
      }
      return;
    }

    // Sticky route
    if (this.stickyActions.includes(msg.action)) {
      let envInstanceId = '';
      if (msg.action === 'fs.sync' || msg.action === 'fs.open.ack' || msg.action === 'fs.conflict.resolve') {
        envInstanceId = workspace.docs[msg.payload.ino];
      } else if (msg.action === 'ssh.data' || msg.action === 'ssh.close') {
        envInstanceId = workspace.sshs[sessionId];
      } else if (msg.action === 'ws.run') {
        envInstanceId = workspace.fs;
      }
      let healthy = false;
      try {
        await firstValueFrom(
          this.redis
            .send<any, ServiceEvent<HealthCheck>>(`env.${envInstanceId}.health`, { payload: {} })
            .pipe(timeout(1000)),
        );
        healthy = true;
      } catch (error) {
        void error;
      }

      if (!healthy) {
        if (
          msg.action === 'fs.sync' ||
          msg.action === 'fs.open.ack' ||
          msg.action === 'fs.conflict.resolve'
        ) {
          await this.handleFSLoss(socket, workspace, msg.payload.uuid, msg.payload.ino);
        } else if (msg.action === 'ssh.data' || msg.action === 'ssh.close') {
          await this.handleSSHSLoss(socket, workspace, sessionId, msg.payload.uuid, msg.payload.sshSessionId);
        } else if (msg.action === 'ws.run') {
          if (msg.correlationId) {
            socket.emit(msg.correlationId, {
              action: 'error',
              payload: { error: { code: 'WS_NOT_REACHABLE' } },
            });
          }
        }
      } else {
        this.redis.emit<any, ServiceEvent<InSocketMessage<'env'>>>(`env.${envInstanceId}`, {
          meta: { uid, sessionId },
          payload: msg,
        });
      }
    } else {
      this.nats.emit<any, ServiceMessage<InSocketMessage<'env'>>>('env.msg', {
        meta: { uid, sessionId },
        payload: msg,
      });
    }
  }
  async handleFSLoss(socket: TypedSocket, workspace: CachedWorkspace, wsUuid: string, ino: number) {
    delete workspace.docs[ino];
    await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
    socket.emit('fs', { action: 'lost', payload: { ino } });
  }
  async handleSSHSLoss(
    socket: TypedSocket,
    workspace: CachedWorkspace,
    sessionId: string,
    wsUuid: string,
    sshSessionId: string,
  ) {
    delete workspace.sshs[sessionId];
    await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);
    socket.emit('ssh', { action: 'closed', payload: { sshSessionId, all: true } });
  }

  async handleCacheExpiry(key: string) {
    const lock = await this.acquireLock([this.lockClient], key, 10 * 1000, 0);

    const [type, ...parts] = key.split(':');
    if (type === 'presence') {
      await this.presenceService.handleStalePresence(parts);
    }

    await lock.release();
  }

  async send<T extends keyof OutSocketMessageActionMap>(data: SocketSend<T>) {
    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(data.uid));
    logger.debug('Presence: ', presence);
    const socketId = presence?.[data.sessionId]?.socketId;
    logger.debug('SocketId: ', socketId);
    if (socketId) {
      this.server.to(socketId).emit(data.pattern as any, data.msg);
    }
    logger.debug('Socket payload sent');
  }
  async broadcast<T extends keyof OutSocketMessageActionMap>(data: SocketBroadcast<T>) {
    const presenceAll = await Promise.all(
      data.uids.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    const socketIds = presenceAll.map((presence, idx) => presence?.[data.sessionIds[idx]].socketId);
    for (const socketId of socketIds) {
      if (socketId) {
        this.server.to(socketId)?.emit(data.pattern as any, data.msg);
      }
    }
  }
}
