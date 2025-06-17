import { Cache } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import {
  CachedPresence,
  CachedWorkspace,
  CACHEKEY_PRESENCE,
  CACHEKEY_PRESENCE_SESSION,
  CACHEKEY_PRESENCE_WORKSPACE,
  CACHEKEY_WORKSPACE,
  GatewayPayload,
  InSocketMessage,
  ServiceEvent,
} from 'hide-common';
import { RedisService } from 'hide-redis';
import { MembershipService } from './membership.service';
import { ClientProxy } from '@nestjs/microservices';

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
      if (
        wsUuid &&
        wsUuid === msg.payload.uuid &&
        (await this.membershipService.checkMembership(uid, msg.payload.uuid))
      ) {
        const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(wsUuid));
        await this.setWorkspaceState(workspace, uid, sessionId, wsUuid, 'active');
      }
    }
  }

  async handleStalePresence(parts: string[]) {
    const [uid, sessionId, wsUuid] = parts;
    if (!wsUuid) {
      await this.handleStaleSession(uid, sessionId);
    } else {
      await this.handleStaleWorkspace(uid, sessionId, wsUuid);
    }
  }
  async handleStaleSession(uid: string, sessionId: string) {
    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (!presence) return;
    const session = presence[sessionId];
    if (!session) return;

    if (session.state === 'active') {
      if (session.wsUuid) {
        const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(session.wsUuid));
        await this.setWorkspaceState(workspace, uid, sessionId, session.wsUuid, 'inactive');
      }
      await this.setSessionState(presence, uid, sessionId, 'inactive');
    } else {
      await this.handleSessionExpiry(presence, uid, sessionId);
    }
  }
  async handleStaleWorkspace(uid: string, sessionId: string, wsUuid: string) {
    const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(wsUuid));
    if (!workspace) return;
    if (workspace.state === 'active') {
      await this.setWorkspaceState(workspace, uid, sessionId, wsUuid, 'inactive');
    } else {
      await this.handleWorkspaceExpiry(uid, sessionId, wsUuid);
    }
  }
  async handleSessionExpiry(presence: CachedPresence, uid: string, sessionId: string) {
    const { gatewayId, socketId, wsUuid } = presence[sessionId];
    this.redis.emit<any, ServiceEvent<GatewayPayload>>(`gateway.${gatewayId}`, {
      payload: { action: 'socket.close', payload: { socketId } },
    });
    if (wsUuid) {
      delete presence[sessionId].wsUuid;
      await this.handleWorkspaceExpiry(uid, sessionId, wsUuid);
    }
    delete presence[sessionId];
    if (Object.keys(presence).length === 0) {
      await this.cache.del(CACHEKEY_PRESENCE(uid));
    } else {
      await this.cache.set<CachedPresence>(CACHEKEY_PRESENCE(uid), presence);
    }
  }
  async handleWorkspaceExpiry(_uid: string, _sessionId: string, wsUuid: string) {
    await this.cache.del(CACHEKEY_WORKSPACE(wsUuid));
    await fetch(`http://provisioner/api/commit?uuid=${wsUuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  }

  async setSessionState(
    presence: CachedPresence,
    uid: string,
    sessionId: string,
    state: 'active' | 'inactive',
  ) {
    presence[sessionId].state = state;
    await this.cache.set(CACHEKEY_PRESENCE(uid), presence);

    if (state === 'inactive') {
      await this.cache.set(CACHEKEY_PRESENCE_SESSION(uid, sessionId), 0, 360000);
    } else {
      await this.cache.set(CACHEKEY_PRESENCE_SESSION(uid, sessionId), 1, 20000);
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
    await this.cache.set(CACHEKEY_WORKSPACE(wsUuid), workspace);

    if (workspace.state === 'inactive') {
      await this.cache.set(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, wsUuid), 0, 300000);
    } else {
      await this.cache.set(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, wsUuid), 1, 20000);
    }
  }
}
