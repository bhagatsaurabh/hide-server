import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WSSharedDoc, YMessage } from 'src/utils/shareddoc';
import { RedisService } from 'hide-redis';
import { Cache } from '@nestjs/cache-manager';
import {
  CachedPresence,
  CachedWorkspace,
  CACHEKEY_PRESENCE,
  CACHEKEY_WORKSPACE,
  InterEnvFSClose,
  InterEnvFSOpen,
  ServiceEvent,
  SocketBroadcast,
  SocketSend,
  StatDTO,
} from 'hide-common';
import { CommonRef } from 'src/common/refs/common.ref';
import { FSConflictResolve, FSOpen, FSOpenAck, FSSyncIn } from 'hide-common/message/filesystem.message';
import { UndoManager } from 'yjs';

// docId = ino
export type ActiveDocs = Map<number, WSSharedDoc>;
// wsUuid
export type DocState = Map<string, ActiveDocs>;

@Injectable()
export class SyncService {
  root = '/workspace';
  docs: DocState = new Map<string, ActiveDocs>();
  cache: Cache;

  constructor(
    @Inject('ENV_SERVICE_REDIS') private redis: ClientProxy,
    private readonly cacheService: RedisService,
  ) {
    this.cache = this.cacheService.get();
  }

  async openFile(
    uid: string,
    sessionId: string,
    { uuid, path }: FSOpen,
    stat: StatDTO,
    correlationId?: string,
  ) {
    const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
    if (!workspace) {
      this.sendError(uid, sessionId, 'FATAL_ERR_NO_WORKSPACE', correlationId);
      return;
    }

    const envInstanceId = workspace.docs[stat.ino];
    if (envInstanceId && CommonRef.getInstanceId() !== envInstanceId) {
      this.redis.emit<any, ServiceEvent<InterEnvFSOpen>>(`env.${envInstanceId}.openfile`, {
        meta: { uid, sessionId },
        payload: { uuid, path, stat, correlationId },
      });
      return;
    }

    try {
      let activeDocs = this.docs.get(uuid);
      if (!activeDocs) {
        activeDocs = new Map();
        this.docs.set(uuid, activeDocs);
      }
      let doc = activeDocs.get(stat.ino);
      if (!doc) {
        doc = new WSSharedDoc(
          stat.ino,
          path,
          uuid,
          (doc) => this.loadFileContent(doc),
          (doc: WSSharedDoc, buf: Uint8Array) => this.broadcast(doc, buf),
          (doc: WSSharedDoc) => this.flush(doc),
          (doc: WSSharedDoc) => this.sendConflict(doc),
        );
        const success = await doc.whenInitialized;
        if (!success) {
          this.sendError(uid, sessionId, 'FS_ERR_READ_FILE', correlationId);
          doc.destroy();
          if (this.docs.get(uuid)?.size === 1) {
            this.docs.delete(uuid);
          }
          return;
        }
        doc.computeHash();
        activeDocs.set(stat.ino, doc);
      }
      doc.users.set(uid, new Set());

      await this.updateCache(uuid, stat.ino, true);
      this.sendSuccess(uid, sessionId, correlationId, doc.isConflicting, doc.conflictResolver);
    } catch (error) {
      void error;
      this.sendError(uid, sessionId, 'FS_ERR_FETCH_FILE', correlationId);
    }
  }
  async closeFile(uid: string, sessionId: string, uuid: string, ino: number) {
    const workspace = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
    if (!workspace) {
      return;
    }

    const envInstanceId = workspace.docs[ino];
    if (envInstanceId && CommonRef.getInstanceId() !== envInstanceId) {
      this.redis.emit<any, ServiceEvent<InterEnvFSClose>>(`env.${envInstanceId}.closefile`, {
        meta: { uid, sessionId },
        payload: { uuid, ino },
      });
      return;
    }

    const doc = this.docs.get(uuid)?.get(ino);
    if (!doc || !doc.users.has(uid)) return;

    const controlledIds = doc.users.get(uid)!;
    doc.users.delete(uid);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);

    if (doc.users.size > 0) return;
    doc.destroy();
    this.docs.get(uuid)?.delete(ino);
    await this.updateCache(uuid, ino, false);
    if (this.docs.get(uuid)?.size) return;
    this.docs.delete(uuid);
  }

  async send(uid: string, uuid: string, ino: number, buf: Uint8Array, sessionId?: string) {
    sessionId = sessionId || (await this.getSessionId(uid, uuid));
    if (!sessionId) return;

    this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
      meta: { uid, sessionId },
      payload: {
        uid,
        pattern: 'fs',
        sessionId,
        msg: {
          action: 'sync',
          payload: {
            ino,
            buf: Buffer.from(buf).toString('base64'),
            uuid,
          },
        },
      },
    });
  }
  async broadcast(doc: WSSharedDoc, buf: Uint8Array) {
    const uids = Array.from(doc.users.keys());
    if (!uids.length) return;

    const results = await Promise.allSettled(uids.map((uid) => this.getSessionId(uid, doc.uuid)));
    const sessionIds = results.map((result) => (result.status === 'fulfilled' ? result.value : undefined));
    const activeUids: string[] = [];
    const activeSessionIds: string[] = [];
    sessionIds.forEach((sessionId, idx) => {
      if (sessionId) {
        activeUids.push(uids[idx]);
        activeSessionIds.push(sessionId);
      }
    });

    this.redis.emit<any, ServiceEvent<SocketBroadcast<'fs'>>>('socket.broadcast', {
      payload: {
        uids: activeUids,
        sessionIds: activeSessionIds,
        pattern: 'fs',
        msg: {
          action: 'sync',
          payload: {
            ino: doc.ino,
            buf: Buffer.from(buf).toString('base64'),
            uuid: doc.uuid,
          },
        },
      },
    });
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
  sendSuccess(
    uid: string,
    sessionId: string,
    correlationId?: string,
    isConflicting?: boolean,
    conflictResolver?: string,
  ) {
    if (correlationId) {
      this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
        meta: { uid, sessionId },
        payload: {
          pattern: correlationId,
          uid,
          sessionId,
          msg: {
            action: 'success',
            payload: { isConflicting, conflictResolver },
          },
        },
      });
    }
  }
  async sendFileMovedOrDeleted(uids: string[], uuid: string, ino: number) {
    if (!uids.length) return;

    const results = await Promise.allSettled(uids.map((uid) => this.getSessionId(uid, uuid)));
    const sessionIds = results.map((result) => (result.status === 'fulfilled' ? result.value : undefined));
    const activeUids: string[] = [];
    const activeSessionIds: string[] = [];
    sessionIds.forEach((sessionId, idx) => {
      if (sessionId) {
        activeUids.push(uids[idx]);
        activeSessionIds.push(sessionId);
      }
    });

    this.redis.emit<any, ServiceEvent<SocketBroadcast<'fs'>>>('socket.broadcast', {
      payload: {
        uids: activeUids,
        sessionIds: activeSessionIds,
        pattern: 'fs',
        msg: { action: 'displaced', payload: { uuid, ino } },
      },
    });
  }
  async sendConflictResolved(uuid: string, uids: string[], ino: number) {
    if (!uids.length) return;

    const results = await Promise.allSettled(uids.map((uid) => this.getSessionId(uid, uuid)));
    const sessionIds = results.map((result) => (result.status === 'fulfilled' ? result.value : undefined));
    const activeUids: string[] = [];
    const activeSessionIds: string[] = [];
    sessionIds.forEach((sessionId, idx) => {
      if (sessionId) {
        activeUids.push(uids[idx]);
        activeSessionIds.push(sessionId);
      }
    });

    this.redis.emit<any, ServiceEvent<SocketBroadcast<'fs'>>>('socket.broadcast', {
      payload: {
        uids: activeUids,
        sessionIds: activeSessionIds,
        pattern: 'fs',
        msg: { action: 'resolved', payload: { uuid, ino } },
      },
    });
  }
  sendFSLoss(uid: string, sessionId: string, ino: number) {
    this.redis.emit<any, ServiceEvent<SocketSend<'fs'>>>('socket.send', {
      meta: { uid, sessionId },
      payload: {
        uid,
        sessionId,
        pattern: 'fs',
        msg: { action: 'lost', payload: { ino } },
      },
    });
  }
  async sendConflict(doc: WSSharedDoc) {
    const uids = [...doc.users.keys()];

    const presences = await Promise.allSettled(
      uids.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    const sessionIds = presences.map((presence) => {
      if (presence.status === 'rejected' || !presence.value) return;

      const entries = Object.entries(presence.value);
      const [sid, _session] = entries.find(([_sid, session]) => session.wsUuid === doc.uuid) ?? [];
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
          msg: {
            action: 'conflict',
            payload: { uuid: doc.uuid, ino: doc.ino, resolverUid: doc.conflictResolver },
          },
        },
      });
    });
  }

  async handleSync(uid: string, sessionId: string, msg: FSSyncIn) {
    const doc = this.docs.get(msg.uuid)?.get(msg.ino);
    if (!doc) return;

    try {
      const encoder = encoding.createEncoder();
      const buf = Uint8Array.from(Buffer.from(msg.buf, 'base64'));
      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder) as YMessage;
      switch (messageType) {
        case YMessage.SYNC:
          encoding.writeVarUint(encoder, YMessage.SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, uid);
          if (encoding.length(encoder) > 1) {
            await this.send(uid, msg.uuid, msg.ino, encoding.toUint8Array(encoder), sessionId);
          }
          break;
        case YMessage.AWARENESS: {
          awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), uid);
          break;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
  async flush(doc: WSSharedDoc) {
    if (doc.isDisplaced || doc.isConflicting) {
      return;
    }

    let ok = false;
    try {
      const stat = await this.getStat(doc.uuid, doc.path);
      if (!stat.isDir) {
        ok = true;
      }
    } catch (error) {
      void error;
    }

    if (!ok) {
      doc.isDisplaced = true;
      await this.sendFileMovedOrDeleted(Array.from(doc.users.keys()), doc.uuid, doc.ino);
      return;
    }

    const content = doc.getText('monaco').toJSON();
    await this.setFileContent(doc, content);
  }

  async handleOpenAck(uid: string, sessionId: string, msg: FSOpenAck) {
    const doc = this.docs.get(msg.uuid)?.get(msg.ino);
    if (!doc) return;

    // Initial Sync
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, YMessage.SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    await this.send(uid, doc.uuid, msg.ino, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, YMessage.AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
      );
      await this.send(uid, doc.uuid, msg.ino, encoding.toUint8Array(encoder), sessionId);
    }
  }
  async handleConflictResolve(uid: string, sessionId: string, msg: FSConflictResolve) {
    const doc = this.docs.get(msg.uuid)?.get(msg.ino);
    if (!doc) {
      this.sendFSLoss(uid, sessionId, msg.ino);
      return;
    }

    if (msg.decision === 'keep') {
      const content = doc.getText('monaco').toJSON();
      await this.setFileContent(doc, content);
    } else {
      await this.loadFileContent(doc, true);
    }

    doc.isConflicting = false;
    doc.conflictResolver = '';
    await this.sendConflictResolved(msg.uuid, [...doc.users.keys()], msg.ino);
  }
  async updateCache(uuid: string, ino: number, add: boolean) {
    const wCache = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
    if (!wCache) return;
    if (add) {
      wCache.docs[ino] = CommonRef.getInstanceId();
    } else {
      delete wCache.docs[ino];
    }
    await this.cache.set(CACHEKEY_WORKSPACE(uuid), wCache);
  }
  async loadFileContent(doc: WSSharedDoc, replace?: boolean) {
    try {
      const res = await fetch(`http://workspace-${doc.uuid}/api/read?path=${doc.path}`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const data = (await res.json()) as { content: string };
      if (!res.ok) {
        console.log('Failed to read file', data);
        return false;
      }

      if (!replace) {
        const ytext = doc.getText('monaco');
        ytext.insert(0, data.content);
      } else {
        doc.transact((t) => {
          const yText = t.doc.getText('monaco');
          yText.delete(0, yText.length);
          yText.insert(0, data.content);

          const undoManager = new UndoManager(yText);
          undoManager.clear();
        }, doc);
      }

      return true;
    } catch (error) {
      console.log(error);
    }
    return false;
  }
  async setFileContent(doc: WSSharedDoc, content: string) {
    try {
      const res = await fetch(`http://workspace-${doc.uuid}/api/write?path=${doc.path}`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      if (res.status < 200 || res.status > 299) {
        console.log('Failed to write file', await res.json());
      }
    } catch (error) {
      console.log(error);
    }
  }
  async getSessionId(uid: string, uuid: string) {
    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (!presence) return;
    const sessions = Object.entries(presence);
    const [sessionId, _session] = sessions.find(([_sessionId, session]) => session.wsUuid === uuid) ?? [];
    return sessionId;
  }
  async getStat(wsUuid: string, path: string) {
    const res = await fetch(`http://workspace-${wsUuid}/api/stat?path=${path}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    if (res.status < 200 || res.status > 299) {
      throw new Error('Not found');
    }
    return (await res.json()) as StatDTO;
  }
}
