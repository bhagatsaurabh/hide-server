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
  ServiceEvent,
  SocketBroadcast,
  SocketSend,
} from 'hide-common';
import { CommonRef } from 'src/common/refs/common.ref';
import { FSOpen, FSOpenAck, FSSyncIn } from 'hide-common/message/filesystem.message';

// path
export type ActiveDocs = Map<string, WSSharedDoc>;
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

  async openFile(uid: string, sessionId: string, { uuid, path }: FSOpen, correlationId?: string) {
    try {
      let activeDocs = this.docs.get(uuid);
      if (!activeDocs) {
        activeDocs = new Map();
        this.docs.set(uuid, activeDocs);
      }
      let doc = activeDocs.get(path);
      if (!doc) {
        doc = new WSSharedDoc(
          path,
          uuid,
          (doc) => this.loadFileContent(doc),
          (...a) => this.broadcast(...a),
          (...a) => this.flush(...a),
        );
        const success = await doc.whenInitialized;
        if (!success) {
          if (correlationId) {
            this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
              meta: { uid, sessionId },
              payload: {
                pattern: correlationId,
                uid,
                sessionId,
                msg: { action: 'error', payload: { error: { code: 'ERR_READ_FILE' } } },
              },
            });
          }
          doc.destroy();
          if (this.docs.get(uuid)?.size === 1) {
            this.docs.delete(uuid);
          }
          return;
        }
        doc.computeHash();
        activeDocs.set(path, doc);
      }
      doc.users.set(uid, new Set());

      await this.updateCache(uuid, path, true);

      this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
        meta: { uid, sessionId },
        payload: {
          pattern: correlationId!,
          uid,
          sessionId,
          msg: {
            action: 'success',
            payload: { content: doc.getText('monaco').toJSON() },
          },
        },
      });
    } catch (error) {
      console.log(error);
      if (correlationId) {
        this.redis.emit<any, ServiceEvent<SocketSend<string>>>('socket.send', {
          meta: { uid, sessionId },
          payload: {
            pattern: correlationId,
            uid,
            sessionId,
            msg: { action: 'error', payload: { error: { code: 'ERR_FETCH_FILE' } } },
          },
        });
      }
    }
  }
  async closeFile(uid: string, uuid: string, path: string) {
    const doc = this.docs.get(uuid)?.get(path);
    if (!doc || !doc.users.has(uid)) return;

    const controlledIds = doc.users.get(uid)!;
    doc.users.delete(uid);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);

    if (doc.users.size > 0) return;
    doc.destroy();
    this.docs.get(uuid)?.delete(doc.name);
    await this.updateCache(uuid, path, false);
    if (this.docs.get(uuid)?.size) return;
    this.docs.delete(uuid);
  }

  async send(uid: string, uuid: string, path: string, buf: Uint8Array, sessionId?: string) {
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
            path,
            buf: Buffer.from(buf).toString('base64'),
            uuid,
          },
        },
      },
    });
  }
  async broadcast(uids: string[], uuid: string, path: string, buf: Uint8Array) {
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
        msg: {
          action: 'sync',
          payload: {
            path,
            buf: Buffer.from(buf).toString('base64'),
            uuid,
          },
        },
      },
    });
  }

  async handleSync(uid: string, sessionId: string, msg: FSSyncIn) {
    msg.path = this.root + msg.path;
    const doc = this.docs.get(msg.uuid)?.get(msg.path);
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
            await this.send(uid, msg.uuid, msg.path, encoding.toUint8Array(encoder), sessionId);
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
  async flush(uuid: string, path: string) {
    const doc = this.docs.get(uuid)?.get(path);
    if (!doc) return;

    const content = doc.getText('monaco').toJSON();
    await this.setFileContent(uuid, path, content);
  }

  async handleOpenAck(uid: string, sessionId: string, msg: FSOpenAck) {
    msg.path = this.root + msg.path;
    const doc = this.docs.get(msg.uuid)?.get(msg.path);
    if (!doc) return;

    // Initial Sync
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, YMessage.SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    await this.send(uid, doc.uuid, msg.path, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, YMessage.AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
      );
      await this.send(uid, doc.uuid, msg.path, encoding.toUint8Array(encoder), sessionId);
    }
  }
  async updateCache(uuid: string, path: string, add: boolean) {
    const wCache = await this.cache.get<CachedWorkspace>(CACHEKEY_WORKSPACE(uuid));
    if (!wCache) return;
    if (add) {
      wCache.docs[path] = CommonRef.getInstanceId();
    } else {
      delete wCache.docs[path];
    }
    await this.cache.set(CACHEKEY_WORKSPACE(uuid), wCache);
  }
  async loadFileContent(doc: WSSharedDoc) {
    try {
      const res = await fetch(`http://workspace-${doc.uuid}/api/read?path=${doc.name}`, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const data = (await res.json()) as { content: string };
      if (!res.ok) {
        console.log('Failed to read file', data);
        return false;
      }

      const ytext = doc.getText('monaco');
      ytext.insert(0, data.content);

      return true;
    } catch (error) {
      console.log(error);
    }
    return false;
  }
  async setFileContent(uuid: string, path: string, content: string) {
    try {
      const res = await fetch(`http://workspace-${uuid}/api/write?path=${path}`, {
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
}
