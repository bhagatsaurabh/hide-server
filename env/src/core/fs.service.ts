import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { join, resolve, sep } from 'node:path';
import { SyncService } from './sync.service';
import Redlock from 'redlock';
import Redis from 'ioredis';
import {
  CachedPresence,
  CachedWorkspace,
  CACHEKEY_PRESENCE,
  CACHEKEY_WORKSPACE,
  debounce,
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
import { pickOne } from 'src/utils';

@Injectable()
export class FSService {
  root = '/workspace';
  idleTimeout: NodeJS.Timeout;
  debounceTime = 250;
  redlock: Redlock;
  lockClient: Redis;
  cache: Cache;

  pathState: Record<
    string,
    {
      uuid: string;
      batch: FSEvent[];
      paths: Map<
        string,
        {
          lastEvent: number;
          count: number;
          bursting: boolean;
          cooldownTimer?: NodeJS.Timeout;
        }
      >;
      process: (wsUuid: string) => void;
    }
  > = {};
  BURST_THRESHOLD = 50;
  BURST_INTERVAL = 200;
  COOLDOWN = 500;

  constructor(
    @Inject('ENV_SERVICE_REDIS') private redis: ClientProxy,
    private readonly syncService: SyncService,
    private readonly cacheService: RedisService,
  ) {
    this.cache = this.cacheService.get();
  }

  setWorkspace(wsUuid: string) {
    this.pathState[wsUuid] = {
      uuid: wsUuid,
      paths: new Map(),
      batch: [],
      process: debounce(async (wsUuid: string) => await this._process(wsUuid), this.debounceTime),
    };
  }
  async openDir(uid: string, sessionId: string, { uuid, path }: FSOpen, correlationId?: string) {
    this.redis.emit(`workspace.${uuid}.watch.add`, { path });

    try {
      const res = await fetch(`http://workspace-${uuid}/api/dir?path=${path}`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      if (res.status < 200 || res.status > 299) {
        throw new Error();
      }
      const entries = (await res.json()) as unknown as FSOpenDTO[];

      this.sendSuccess(uid, sessionId, entries, correlationId);
      await this.updateCache(uid, uuid, path, true);
    } catch (error) {
      void error;
      this.sendError(uid, sessionId, 'FS_ERR_FETCH_DIRECTORY', correlationId);
    }
  }
  async closeDir(uid: string, wsUuid: string, path: string) {
    await this.updateCache(uid, wsUuid, path, false);
  }
  closeDirs(uid: string, wsUuid: string, paths: string[], workspace: CachedWorkspace) {
    paths.forEach((path) => {
      const watchers = workspace.dirs[path];
      watchers.splice(watchers.indexOf(uid), 1);
      if (watchers.length === 0) {
        delete workspace.dirs[path];
        this.redis.emit(`workspace.${wsUuid}.watch.remove`, { path });
      }
    });
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

  async handleWatchEvent({ event, uuid }: InternalWorkspaceWatch) {
    const wState = this.pathState[uuid];
    if (!wState) return;

    let state = wState.paths.get(event.watchedPath);
    if (!state) {
      state = { lastEvent: 0, count: 0, bursting: false };
      wState.paths.set(event.watchedPath, state);
    }

    if (event.timestamp - state.lastEvent > this.BURST_INTERVAL) {
      state.count = 0;
    }
    state.count += 1;
    state.lastEvent = event.timestamp;

    if (!state.bursting && state.count > this.BURST_THRESHOLD) {
      state.bursting = true;
      await this.signal(uuid, event.watchedPath, 'block');
    }

    if (state.bursting) {
      clearTimeout(state.cooldownTimer);
      state.cooldownTimer = setTimeout(() => {
        state.bursting = false;
        void this.signal(uuid, event.watchedPath, 'resume');
      }, this.COOLDOWN);
      return;
    }

    wState.batch.push(event);
    wState.process(uuid);
  }
  async signal(uuid: string, path: string, action: 'resume' | 'block') {
    const { uids, sessionIds } = await this.getWatchingUsersFromPath(uuid, path);
    sessionIds.forEach((sessionId, idx) => {
      if (!sessionId) return;
      this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
        meta: { uid: uids[idx], sessionId },
        payload: {
          uid: uids[idx],
          pattern: 'fs',
          sessionId,
          msg: { action, payload: { path } },
        },
      });
    });
  }
  async _process(uuid: string) {
    const wState = this.pathState[uuid];
    if (!wState) return;
    await this.sync(uuid, wState.batch);
    wState.batch = [];
  }
  async sync(uuid: string, batch: FSEvent[]) {
    const wCache = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
    if (!wCache) return;

    const batches: { [uid: string]: FSEvent[] } = {};
    for (const event of batch) {
      if (event.type === 'file' && event.action === 'write') {
        const docHash = await this.getDocHash(uuid, event.ino!, wCache);
        if (!docHash) {
          continue;
        }
        const fileHash = await this.getFileHash(uuid, event.path);

        if (fileHash === docHash) {
          continue;
        } else {
          const doc = this.syncService.docs.get(uuid)?.get(event.ino!);
          if (doc) {
            doc.isConflicting = true;
            doc.conflictResolver = pickOne([...doc.users.keys()]);
            await this.sendConflict(doc.uuid, doc.ino, [...doc.users.keys()], doc.conflictResolver);
          }
        }
      }

      if (event.watchedPath === '/workspace') {
        event.watchedPath = event.watchedPath + '/';
      }

      for (const uid of wCache.dirs[event.watchedPath] ?? []) {
        if (!batches[uid]) batches[uid] = [];
        batches[uid].push(event);
      }
    }

    const { uids, sessionIds } = await this.getWatchingUsersFromUid(uuid, Object.keys(batches));
    sessionIds.forEach((sessionId, idx) => {
      if (!sessionId) return;
      this.sendBatch(uids[idx], sessionId, batches[uids[idx]] || []);
    });
  }

  sendSuccess(uid: string, sessionId: string, entries: FSOpenDTO[], correlationId?: string) {
    if (correlationId) {
      this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
        meta: { uid, sessionId },
        payload: {
          pattern: correlationId,
          uid,
          sessionId,
          msg: { action: 'success', payload: { entries, correlationId } },
        },
      });
    }
  }
  sendError(uid: string, sessionId: string, code: string, correlationId?: string) {
    if (correlationId) {
      this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
        meta: { uid, sessionId },
        payload: {
          pattern: correlationId,
          uid,
          sessionId,
          msg: { action: 'error', payload: { error: { code } } },
        },
      });
    }
  }
  sendBatch(uid: string, sessionId: string, events: FSEvent[]) {
    this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
      meta: { uid, sessionId },
      payload: {
        uid,
        pattern: 'fs',
        sessionId,
        msg: { action: 'batch', payload: { events } },
      },
    });
  }
  async sendConflict(uuid: string, ino: number, uids: string[], resolverUid: string) {
    const presences = await Promise.allSettled(
      uids.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    const sessionIds = presences.map((presence) => {
      if (presence.status === 'rejected' || !presence.value) return;

      const entries = Object.entries(presence.value);
      const [sid, _session] = entries.find(([_sid, session]) => session.wsUuid === uuid) ?? [];
      return sid;
    });

    sessionIds.forEach((sessionId, idx) => {
      if (!sessionId) return;

      this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
        meta: { uid: uids[idx], sessionId },
        payload: {
          uid: uids[idx],
          sessionId,
          pattern: 'fs',
          msg: { action: 'conflict', payload: { uuid, ino, resolverUid: resolverUid } },
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
    try {
      const res = await fetch(`http://workspace-${uuid}/api/hash?path=${path}`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const data = (await res.json()) as { hex: string };
      if (!res.ok) {
        console.log('Failed to get file hash', data);
        return '';
      }
      return data.hex;
    } catch (error) {
      console.log(error);
    }
    return '';
  }
  async getDocHash(uuid: string, ino: number, wCache: CachedWorkspace) {
    let hash: string | undefined;
    if (!wCache.docs[ino]) return hash;

    const envInstanceId = wCache.docs[ino];
    if (CommonRef.getInstanceId() === envInstanceId) {
      hash = this.syncService.docs.get(uuid)?.get(ino)?.computeHash();
    } else {
      hash = await firstValueFrom(
        this.redis.send<string, ServiceEvent<InSocketMessage<'internal'>>>(`env.${envInstanceId}`, {
          payload: { service: 'internal', action: 'doc.hash', payload: { uuid, ino } },
        }),
      );
    }

    return hash;
  }
}
