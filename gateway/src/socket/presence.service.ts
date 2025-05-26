import { Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import {
  CachedPresence,
  CachedWorkspace,
  GatewayPayload,
  InSocketMessage,
  ServiceEvent,
  ServiceMessage,
} from 'hide-common';
import { RedisService } from 'hide-redis';
import { MembershipService } from './membership.service';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PresenceService {
  cache: Cache;

  constructor(
    private readonly redisService: RedisService,
    private readonly membershipService: MembershipService,
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('GATEWAY_SERVICE_NATS') private nats: ClientProxy,
  ) {
    this.cache = this.redisService.get();
  }

  async handlePresenceMessage(
    uid: string,
    sessionId: string,
    presence: CachedPresence,
    msg: InSocketMessage<'presence'>,
  ) {
    if (msg.action === 'session.ping') {
      await this.setSessionState(presence, uid, sessionId, 'active');

      const { wsUuid } = presence[sessionId];
      const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);
      if (
        wsUuid &&
        workspace &&
        wsUuid === msg.payload.uuid &&
        (await this.membershipService.checkMembership(uid, msg.payload.uuid))
      ) {
        await this.setWorkspaceState(workspace, uid, sessionId, wsUuid, 'active');
      }
    }
  }

  async handlePresenceExpiry(parts: string[]) {
    const [uid, sessionId, wsUuid] = parts;
    const presence = await this.cache.get<CachedPresence>(`presence:${uid}`);
    if (!presence) return;
    const workspace = await this.cache.get<CachedWorkspace>(`workspace:${wsUuid}`);

    if (!wsUuid) {
      if (presence[sessionId].state === 'active') {
        await this.setSessionState(presence, uid, sessionId, 'inactive');
        await this.setWorkspaceState(workspace, uid, sessionId, wsUuid, 'inactive');
      } else {
        await this.handleSessionExpiry(presence, workspace, uid, sessionId);
      }
    } else {
      if (!workspace) return;
      if (workspace.state === 'active') {
        await this.setWorkspaceState(workspace, uid, sessionId, wsUuid, 'inactive');
      } else {
        await this.handleWorkspaceExpiry(uid, sessionId, wsUuid);
      }
    }
  }
  async handleSessionExpiry(
    presence: CachedPresence,
    workspace: CachedWorkspace | null,
    uid: string,
    sessionId: string,
  ) {
    const { gatewayId, socketId, wsUuid } = presence[sessionId];
    this.redis.emit<any, ServiceEvent<GatewayPayload>>(`gateway.${gatewayId}`, {
      payload: { action: 'socket.close', payload: { socketId } },
    });
    if (workspace) {
      await this.handleWorkspaceExpiry(uid, sessionId, wsUuid!);
    }
    delete presence[sessionId];
    if (Object.keys(presence).length === 0) {
      await this.cache.del(`presence:${uid}`);
    } else {
      await this.cache.set<CachedPresence>(`presence:${uid}`, presence);
    }
  }
  async handleWorkspaceExpiry(uid: string, sessionId: string, wsUuid: string) {
    const observable = this.nats.send<any, ServiceMessage<InSocketMessage<'internal'>>>('env.msg', {
      meta: { uid },
      payload: {
        service: 'internal',
        action: 'workspace.close',
        payload: { uid, uuid: wsUuid, sessionId },
      },
    });
    await firstValueFrom(observable);
  }

  async setSessionState(
    presence: CachedPresence,
    uid: string,
    sessionId: string,
    state: 'active' | 'inactive',
  ) {
    presence[sessionId].state = state;
    await this.cache.set<CachedPresence>(`presence:${uid}`, presence);

    if (state === 'inactive') {
      await this.cache.set(`presence:${uid}:${sessionId}`, 0, 360000);
    } else {
      await this.cache.set(`presence:${uid}:${sessionId}`, 1, 20000);
    }
  }
  async setWorkspaceState(
    workspace: CachedWorkspace | null,
    uid: string,
    sessionId: string,
    wsUuid: string | undefined,
    state: 'active' | 'inactive',
  ) {
    if (!workspace || !wsUuid) return;
    workspace.state = state;
    await this.cache.set<CachedWorkspace>(`workspace:${wsUuid}`, workspace);

    if (workspace.state === 'inactive') {
      await this.cache.set(`presence:${uid}:${sessionId}:${wsUuid}`, 0, 300000);
    } else {
      await this.cache.set(`presence:${uid}:${sessionId}:${wsUuid}`, 1, 20000);
    }
  }
}
