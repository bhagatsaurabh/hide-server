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
  SocketSend,
} from 'hide-common';
import { RedisService } from 'hide-redis';
import { MembershipService } from './membership.service';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PresenceService {
  cache: Cache;
  wsPingTimeout: number;
  wsActivityTimeout: number;
  sessionPingTimeout: number;
  sessionActivityTimeout: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly membershipService: MembershipService,
    @Inject('GATEWAY_SERVICE_REDIS') private redis: ClientProxy,
  ) {
    this.cache = this.redisService.get();

    const wsPingTimeout = parseInt(process.env.WORKSPACE_PING_TIMEOUT as string);
    this.wsPingTimeout = isNaN(wsPingTimeout) ? 20000 : wsPingTimeout;

    const wsActivityTimeout = parseInt(process.env.WORKSPACE_ACTIVITY_TIMEOUT as string);
    this.wsActivityTimeout = isNaN(wsActivityTimeout) ? 300000 : wsActivityTimeout;

    const sessionPingTimeout = parseInt(process.env.SESSION_PING_TIMEOUT as string);
    this.sessionPingTimeout = isNaN(sessionPingTimeout) ? 20000 : sessionPingTimeout;

    const sessionActivityTimeout = parseInt(process.env.SESSION_ACTIVITY_TIMEOUT as string);
    this.sessionActivityTimeout = isNaN(sessionActivityTimeout) ? 360000 : sessionActivityTimeout;
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
        if (workspace) {
          return workspace.dirs['/workspace/'];
        }
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
      await this.handleWorkspaceExpiry(wsUuid);
    }
  }
  async handleSessionExpiry(presence: CachedPresence, uid: string, sessionId: string) {
    const { gatewayId, socketId, wsUuid } = presence[sessionId];
    try {
      this.redis.emit<any, ServiceEvent<GatewayPayload>>(`gateway.${gatewayId}`, {
        payload: { action: 'socket.close', payload: { socketId } },
      });
    } catch (error) {
      console.log(error);
    }
    if (wsUuid) {
      delete presence[sessionId].wsUuid;
      await this.handleWorkspaceExpiry(wsUuid);
    }
    delete presence[sessionId];
    if (Object.keys(presence).length === 0) {
      await this.cache.del(CACHEKEY_PRESENCE(uid));
    } else {
      await this.cache.set<CachedPresence>(CACHEKEY_PRESENCE(uid), presence);
    }
  }
  async handleWorkspaceExpiry(wsUuid: string) {
    const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(wsUuid));
    if (workspace) {
      const uids = new Set<string>();
      Object.values(workspace.dirs).forEach((wsUids) => wsUids.forEach((uid) => uids.add(uid)));
      const userIds = [...uids];
      const presences = await Promise.allSettled(
        userIds.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
      );
      const sessionIds = presences.map((presence) => {
        if (presence.status === 'rejected' || !presence.value) return;

        const entries = Object.entries(presence.value);
        const [sid, _session] = entries.find(([_sid, session]) => session.wsUuid === wsUuid) ?? [];
        return sid;
      });
      await Promise.allSettled(
        sessionIds.map(
          (sessionId, idx) =>
            sessionId && this.cache.del(CACHEKEY_PRESENCE_WORKSPACE(userIds[idx], sessionId, wsUuid)),
        ),
      );
      userIds.forEach((uid, idx) => {
        if (sessionIds[idx]) {
          this.redis.emit<unknown, ServiceEvent<SocketSend<'env'>>>('socket.send', {
            meta: { uid, sessionId: sessionIds[idx] },
            payload: {
              pattern: 'env',
              uid,
              sessionId: sessionIds[idx],
              msg: { action: 'disconnect', payload: { code: 'INACTIVE_TIMEOUT' } },
            },
          });
        }
      });
    }
    await this.cache.del(CACHEKEY_WORKSPACE(wsUuid));
    await fetch(`http://provisioner/api/dispose?uuid=${wsUuid}`, {
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
      await this.cache.set(CACHEKEY_PRESENCE_SESSION(uid, sessionId), 0, this.sessionActivityTimeout);
    } else {
      await this.cache.set(CACHEKEY_PRESENCE_SESSION(uid, sessionId), 1, this.sessionPingTimeout);
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
      await this.cache.set(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, wsUuid), 0, this.wsActivityTimeout);
    } else {
      await this.cache.set(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, wsUuid), 1, this.wsPingTimeout);
    }
  }
}
