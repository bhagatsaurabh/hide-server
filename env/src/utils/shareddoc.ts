import { createHash } from 'node:crypto';
import { Doc, Transaction } from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { debounce } from 'hide-common';

export type AwarenessUpdate = { added: number[]; updated: number[]; removed: number[] };
export enum YMessage {
  SYNC = 0,
  AWARENESS = 1,
}

export class WSSharedDoc extends Doc {
  hash: string;
  awareness: awarenessProtocol.Awareness;
  users: Map<string, Set<number>>;
  whenInitialized: Promise<boolean>;
  debounceTime = 3000;
  _flush: (...args: any[]) => void;
  private awarenessChangeHandler: (update: AwarenessUpdate, uid: string) => void;
  private updateHandler: (update: Uint8Array, _origin: unknown, doc: WSSharedDoc, _tr: Transaction) => void;

  constructor(
    public name: string,
    public uuid: string,
    contentInitializor: (doc: WSSharedDoc) => Promise<boolean>,
    public send: (uids: string[], uuid: string, path: string, buf: Uint8Array) => Promise<void>,
    flush: (uuid: string, path: string) => Promise<void>,
  ) {
    super({ gc: true });
    this.users = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.awarenessChangeHandler = this._awarenessChangeHandler.bind(
      this,
    ) as typeof this._awarenessChangeHandler;
    this.updateHandler = this._updateHandler.bind(this) as typeof this._updateHandler;

    this.awareness.on('update', this.awarenessChangeHandler);
    this.on('update', this.updateHandler);

    this._flush = debounce(async (uuid: string, path: string) => await flush(uuid, path), this.debounceTime);

    this.whenInitialized = contentInitializor(this);
    /* const yText = this.getText('monaco');
    const text = content;
    yText.insert(0, text);
    this.computeHash(); */
  }

  _awarenessChangeHandler({ added, updated, removed }: AwarenessUpdate, uid: string): void {
    const changedClients = added.concat(updated, removed);
    if (uid !== null) {
      const userControlledIDs = this.users.get(uid);
      if (userControlledIDs !== undefined) {
        added.forEach((clientID) => userControlledIDs.add(clientID));
        removed.forEach((clientID) => userControlledIDs.delete(clientID));
      }
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, YMessage.AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
    );
    const buf = encoding.toUint8Array(encoder);
    void this.send(Array.from(this.users.keys()), this.uuid, this.name, buf);
  }
  _updateHandler(update: Uint8Array, _origin: unknown, doc: WSSharedDoc, _tr: Transaction) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, YMessage.SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const buf = encoding.toUint8Array(encoder);

    // applyUpdate(doc, buf, this);
    void this.send(Array.from(doc.users.keys()), doc.uuid, doc.name, buf);
    // this._flush(this.uuid, this.name);
  }

  computeHash(content?: string) {
    if (!content) {
      content = this.getText('monaco').toJSON();
    }
    this.hash = createHash('sha256').update(content, 'utf-8').digest('hex');
    return this.hash;
  }
}
