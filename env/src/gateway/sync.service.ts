import { promises as fs } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import {
  FSDocSyncEvent,
  Message,
  FSSync,
  FSSaveRequest,
  ServiceEvent,
  SocketBroadcast,
  SocketSend,
} from 'src/common/message';
import { WSSharedDoc, YMessage } from 'src/utils/shareddoc';
import { createHash } from 'node:crypto';

@Injectable()
export class SyncService {
  uuid = process.env.WS_UUID!;

  constructor(@Inject('FILESYSTEM_SERVICE_REDIS') private redis: ClientProxy) {}

  docs = new Map<string, WSSharedDoc>();
  root = '/home/devuser/workspace';

  openFile(uid: string, path: string) {
    let doc = this.docs.get(path);
    if (!doc) {
      doc = new WSSharedDoc(
        path,
        (...a) => this.broadcast(...a),
        (...a) => this.init(...a),
      );
      this.docs.set(path, doc);
    }
    doc.users.set(uid, new Set());

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, YMessage.SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.send(uid, path, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, YMessage.AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
      );
      this.send(uid, path, encoding.toUint8Array(encoder));
    }
  }
  closeFile(uid: string, path: string) {
    const doc = this.docs.get(path);
    if (!doc) return;

    if (doc.users.has(uid)) {
      const controlledIds = doc.users.get(uid)!;
      doc.users.delete(uid);
      awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
      if (doc.users.size === 0) {
        doc.destroy();
        this.docs.delete(doc.name);
      }
    }
  }

  broadcast(uids: string[], path: string, buf: Uint8Array) {
    this.redis.emit<any, ServiceEvent<SocketBroadcast<FSSync>>>('socket.broadcast', {
      payload: {
        uids,
        pattern: 'fs',
        msg: {
          action: 'sync',
          path: path.replace(this.root, ''),
          buf: Buffer.from(buf).toString('base64'),
          uuid: this.uuid,
        },
      },
    });
  }
  send(uid: string, path: string, buf: Uint8Array) {
    this.redis.emit<any, ServiceEvent<SocketSend<FSSync>>>('socket.send', {
      payload: {
        uid,
        pattern: 'fs',
        msg: {
          action: 'sync',
          path: path.replace(this.root, ''),
          buf: Buffer.from(buf).toString('base64'),
          uuid: this.uuid,
        },
      },
    });
  }
  async init(doc: WSSharedDoc) {
    const yText = doc.getText('monaco');
    const text = await fs.readFile(doc.name, 'utf-8');
    yText.insert(0, text);
  }

  handleFSUpdate(msg: Message<FSDocSyncEvent>) {
    msg.payload.path = this.root + msg.payload.path;
    const doc = this.docs.get(msg.payload.path);
    if (!doc) return;

    try {
      const encoder = encoding.createEncoder();
      const buf = Uint8Array.from(Buffer.from(msg.payload.buf, 'base64'));
      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder) as YMessage;
      switch (messageType) {
        case YMessage.SYNC:
          encoding.writeVarUint(encoder, YMessage.SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, msg.meta.uid);
          if (encoding.length(encoder) > 1) {
            this.send(msg.meta.uid, msg.payload.path, encoding.toUint8Array(encoder));
          }
          break;
        case YMessage.AWARENESS: {
          awarenessProtocol.applyAwarenessUpdate(
            doc.awareness,
            decoding.readVarUint8Array(decoder),
            msg.meta.uid,
          );
          break;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
  async handleFSSave(msg: Message<FSSaveRequest>) {
    msg.payload.path = this.root + msg.payload.path;
    const doc = this.docs.get(msg.payload.path);
    if (!doc) return;

    const content = doc.getText('monaco').toJSON();
    await fs.writeFile(msg.payload.path, content, 'utf-8');
  }

  async getHashFromFile(path: string) {
    const content = await fs.readFile(path, 'utf-8');
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  dispose() {
    // TODO
  }
}
