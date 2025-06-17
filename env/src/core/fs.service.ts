import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { join, resolve, sep } from 'node:path';
import { debounce } from 'src/utils';
import { SyncService } from './sync.service';
import Redlock from 'redlock';
import Redis from 'ioredis';
import {
  CachedPresence,
  CachedWorkspace,
  CACHEKEY_PRESENCE,
  CACHEKEY_WORKSPACE,
  FSOpenDTO,
  InSocketMessage,
  ServiceEvent,
  SocketSend,
} from 'hide-common';
import { RedisService } from 'hide-redis';
import { Cache } from '@nestjs/cache-manager';
import { FSEvent, FSOpen, InternalWorkspaceWatch } from 'hide-common/message/filesystem.message';
import { CommonRef } from 'src/common/refs/common.ref';
import { firstValueFrom } from 'rxjs';

type WatchEventState = {
  uuid: string;
  events: Array<FSEvent>;
  buffer: Array<FSEvent>;
  isProcessing: boolean;
  busy: { path: string } | null;
  process: (wsUuid: string) => void;
  timer?: NodeJS.Timeout;
};

@Injectable()
export class FSService {
  root = '/home/devuser/workspace';
  idleTimeout: NodeJS.Timeout;
  state: Record<string, WatchEventState> = {};
  debounceTime = 250;
  redlock: Redlock;
  lockClient: Redis;
  cache: Cache;

  constructor(
    @Inject('FILESYSTEM_SERVICE_REDIS') private redis: ClientProxy,
    private readonly syncService: SyncService,
    private readonly cacheService: RedisService,
  ) {
    this.cache = this.cacheService.get();
  }

  setWorkspace(wsUuid: string) {
    this.state[wsUuid] = {
      uuid: wsUuid,
      events: [],
      buffer: [],
      isProcessing: false,
      busy: null,
      process: debounce(async (wsUuid: string) => await this._process(wsUuid), this.debounceTime),
    };
  }
  async openDir(uid: string, sessionId: string, { uuid, path }: FSOpen, correlationId?: string) {
    this.redis.emit(`workspace.${uuid}.watch.add`, { path });

    try {
      const res = await fetch(`http://workspace-${uuid}/api/dir?path=${path}`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const entries = (await res.json()) as unknown as FSOpenDTO[];
      this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
        meta: { uid, sessionId },
        payload: {
          pattern: correlationId!,
          uid,
          sessionId,
          msg: { action: 'success', payload: { entries, correlationId } },
        },
      });

      await this.updateCache(uid, uuid, path, true);
    } catch (error) {
      void error;
      if (correlationId) {
        this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
          meta: { uid, sessionId },
          payload: {
            pattern: correlationId,
            uid,
            sessionId,
            msg: { action: 'error', payload: { error: { code: 'ERR_FETCH_DIRECTORY' } } },
          },
        });
      }
    }
  }
  async closeDir(uid: string, wsUuid: string, path: string) {
    await this.updateCache(uid, wsUuid, path, false);
  }
  async updateCache(uid: string, wsUuid: string, path: string, add: boolean) {
    const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(wsUuid));
    if (!workspace) return;
    let watchers = workspace.dirs[path];
    if (add) {
      if (!watchers) watchers = [];
      watchers = Array.from(new Set([...watchers, uid]));
      workspace.dirs[path] = watchers;
    } else if (watchers && watchers.includes(uid)) {
      watchers.splice(watchers.indexOf(uid), 1);
      if (watchers.length === 0) {
        delete workspace.dirs[path];
        this.redis.emit(`workspace.${wsUuid}.watch.remove`, { path });
      }
    }
    await this.cache.set(CACHEKEY_WORKSPACE(wsUuid), workspace);
  }

  async handleWatchEvent(msg: InternalWorkspaceWatch) {
    const { uuid, event } = msg;
    const wState = this.state[uuid];
    if (!wState || wState.busy) return;
    wState[wState.isProcessing ? 'buffer' : 'events'].push(event);

    wState.busy = await this.burstProtection(wState);
    wState.process(uuid);
  }
  async burstProtection(wState: WatchEventState) {
    const threshold = parseInt(process.env.EVENT_QUEUE_SIZE || '100');
    if (wState.events.length >= threshold || wState.buffer.length >= threshold) {
      const paths = new Set<string>();
      let events: FSEvent[];
      if (wState.events.length >= threshold) events = wState.events;
      else events = wState.buffer;

      for (const event of events) {
        paths.add(event.watchedPath);
      }
      const blockedPath = this.commonParent(Array.from(paths));
      const { uids, sessionIds } = await this.getWatchingUsersFromPath(wState.uuid, blockedPath);
      sessionIds.forEach((sessionId, idx) => {
        if (!sessionId) return;
        this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
          meta: { uid: uids[idx], sessionId },
          payload: {
            uid: uids[idx],
            pattern: 'fs',
            sessionId,
            msg: { action: 'block', payload: { path: blockedPath } },
          },
        });
      });

      return { path: blockedPath };
    }
    return null;
  }
  async _process(wsUuid: string) {
    const wState = this.state[wsUuid];
    if (!wState) return;
    if (wState.busy) {
      const { uids, sessionIds } = await this.getWatchingUsersFromPath(wsUuid, wState.busy.path);
      for (let idx = 0; idx < sessionIds.length; idx += 1) {
        const sessionId = sessionIds[idx];
        if (!sessionId) continue;
        this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
          payload: {
            uid: uids[idx],
            pattern: 'fs',
            sessionId,
            msg: { action: 'resume', payload: { path: wState.busy.path } },
          },
        });
      }
      wState.busy = null;
      return;
    }

    wState.isProcessing = true;
    await this.sync(wState);
    wState.events = wState.buffer;
    wState.buffer = [];
    wState.isProcessing = false;
  }
  async sync({ events, uuid }: WatchEventState) {
    const wCache = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
    if (!wCache) return;

    const batches: { [uid: string]: FSEvent[] } = {};
    for (const event of events) {
      if (event.type === 'file' && event.action === 'write') {
        const docHash = await this.getDocHash(uuid, event.path, wCache);
        if (!docHash) {
          continue;
        }
        const fileHash = await this.getFileHash(uuid, event.path);
        if (fileHash === docHash) {
          continue;
        }
      }

      this.cleanPaths(event);
      for (const uid of wCache.dirs[event.watchedPath]) {
        if (!batches[uid]) batches[uid] = [];
        batches[uid].push(event);
      }
    }

    const { uids, sessionIds } = await this.getWatchingUsersFromUid(uuid, Object.keys(batches));
    sessionIds.forEach((sessionId, idx) => {
      if (!sessionId) return;
      this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
        meta: { uid: uids[idx], sessionId },
        payload: {
          uid: uids[idx],
          pattern: 'fs',
          sessionId,
          msg: { action: 'batch', payload: { events: batches[uids[idx]] || [] } },
        },
      });
    });
  }

  cleanPaths(event: FSEvent) {
    event.path = event.path.replace(this.root, '');
    if (event.path === '') event.path = '/';
    event.watchedPath = event.watchedPath.replace(this.root, '');
    if (event.watchedPath === '') event.watchedPath = '/';
    if (event.oldPath) {
      event.oldPath = event.oldPath.replace(this.root, '');
      if (event.oldPath === '') event.oldPath = '/';
    }
  }
  commonParent(paths: string[]) {
    const splitPaths = paths.map((p) => resolve(p).split(sep));

    const common: string[] = [];
    for (let i = 0; ; i++) {
      const segment = splitPaths[0][i];
      if (segment === undefined) break;

      if (splitPaths.every((parts) => parts[i] === segment)) {
        common.push(segment);
      } else {
        break;
      }
    }

    return sep + join(...common);
  }
  async getWatchingUsersFromPath(uuid: string, path: string, cachedWorkspace?: CachedWorkspace) {
    let wCache: CachedWorkspace;
    if (cachedWorkspace) {
      wCache = cachedWorkspace;
    } else {
      const cache = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
      if (!cache) return { uids: [], sessionIds: [] };
      wCache = cache;
    }

    const uids = wCache.dirs[path];
    const presences = await Promise.allSettled(
      uids.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    const sessionIds = presences.map((presence) => {
      if (presence.status === 'rejected' || !presence.value) return;

      const entries = Object.entries(presence.value);
      const [sid, _session] = entries.find(([_sid, session]) => session.wsUuid === uuid) ?? [];
      return sid;
    });
    return { uids, sessionIds };
  }
  async getWatchingUsersFromUid(uuid: string, uids: string[]) {
    const presences = await Promise.allSettled(
      uids.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    const sessionIds = presences.map((presence) => {
      if (presence.status === 'rejected' || !presence.value) return;

      const entries = Object.entries(presence.value);
      const [sid, _session] = entries.find(([_sid, session]) => session.wsUuid === uuid) ?? [];
      return sid;
    });
    return { uids, sessionIds };
  }
  async getFileHash(uuid: string, path: string) {
    const res = await fetch(`http://workspace-${uuid}/api/hash?path=${path}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const { hash } = (await res.json()) as { hash: string };
    return hash;
  }
  async getDocHash(uuid: string, path: string, wCache: CachedWorkspace) {
    let hash: string | undefined;
    if (!wCache.docs[path]) return hash;

    const envInstanceId = wCache.docs[path];
    if (CommonRef.getInstanceId() === envInstanceId) {
      hash = this.syncService.docs.get(uuid)?.get(path)?.computeHash();
    } else {
      hash = await firstValueFrom(
        this.redis.send<string, ServiceEvent<InSocketMessage<'internal'>>>(`env.${envInstanceId}`, {
          payload: { service: 'internal', action: 'doc.hash', payload: { uuid, path } },
        }),
      );
    }

    return hash;
  }
}
