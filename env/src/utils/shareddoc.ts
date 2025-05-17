import { createHash } from 'node:crypto';
import { applyUpdate, Doc, Transaction } from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';

export type AwarenessUpdate = { added: number[]; updated: number[]; removed: number[] };
export enum YMessage {
  SYNC = 0,
  AWARENESS = 1,
}

export class WSSharedDoc extends Doc {
  hash: string;
  awareness: awarenessProtocol.Awareness;
  users: Map<string, Set<number>>;
  whenInitialized: Promise<void>;

  constructor(
    public name: string,
    public send: (uids: string[], path: string, buf: Uint8Array) => void,
    public init: (doc: WSSharedDoc) => Promise<void>,
  ) {
    super({ gc: true });
    this.users = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    this.awareness.on('update', (update: AwarenessUpdate, uid: string) =>
      this.awarenessChangeHandler(update, uid),
    );
    this.on('update', (update: Uint8Array, origin: unknown, doc: WSSharedDoc, tran: Transaction) =>
      this.updateHandler(update, origin, doc, tran),
    );

    this.init(this)
      .then(() => this.computeHash())
      .catch((err) => console.log(err));
  }

  awarenessChangeHandler({ added, updated, removed }: AwarenessUpdate, uid: string) {
    const changedClients = added.concat(updated, removed);
    if (uid !== null) {
      const userControlledIDs = this.users.get(uid);
      if (userControlledIDs !== undefined) {
        added.forEach((clientID) => {
          userControlledIDs.add(clientID);
        });
        removed.forEach((clientID) => {
          userControlledIDs.delete(clientID);
        });
      }
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, YMessage.AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
    );
    const buf = encoding.toUint8Array(encoder);
    this.send(Array.from(this.users.keys()), this.name, buf);
  }
  updateHandler(update: Uint8Array, _origin: unknown, doc: WSSharedDoc, _tr: unknown) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, YMessage.SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const buf = encoding.toUint8Array(encoder);

    applyUpdate(doc, buf, this);
    this.send(Array.from(doc.users.keys()), doc.name, buf);
  }

  computeHash(content?: string) {
    if (!content) {
      content = this.getText('monaco').toJSON();
    }
    this.hash = createHash('sha256').update(content, 'utf-8').digest('hex');
    return this.hash;
  }
}
