import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  FSExtEvent,
  FSBlock,
  FSResume,
  FSEventBatch,
  FSEvent,
  ServiceEvent,
  SocketSend,
} from 'src/common/message';
import { debounce } from 'src/utils';
import { SyncService } from './sync.service';

type EventCache = {
  events: Array<FSExtEvent>;
  buffer: Array<FSExtEvent>;
  isProcessing: boolean;
  timer?: NodeJS.Timeout;
};

@Injectable()
export class FSService {
  constructor(
    @Inject('FILESYSTEM_SERVICE_REDIS') private redis: ClientProxy,
    private readonly syncService: SyncService,
  ) {
    this.setIdleTimeout();
  }

  root = '/home/devuser/workspace';
  idleTimeout: NodeJS.Timeout;
  cache: EventCache = { events: [], buffer: [], isProcessing: false };
  debounceTime = 250;
  busy: { uids: string[]; path: string } | null = null;
  process = debounce(async () => await this._process(), this.debounceTime);

  setIdleTimeout() {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    this.idleTimeout = setTimeout(() => this.handleCold(), parseInt(process.env.IDLE_TIMEOUT!) || 1800000);
  }

  async openDir(uid: string, path: string) {
    this.redis.emit('add-watch', { uid, path });

    try {
      const entries = await fs.readdir(path, { withFileTypes: true });
      const ids = (await Promise.all(entries.map((entry) => fs.lstat(join(path, entry.name))))).map(
        (stat) => stat.ino,
      );
      return entries.map((entry, idx) => ({
        name: entry.name,
        path: join(path, entry.name),
        type: entry.isDirectory() ? 'dir' : 'file',
        id: ids[idx],
      }));
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Failed to read directory');
    }
  }
  closeDir(uid: string, path: string) {
    this.redis.emit('remove-watch', { uid, path });
  }

  handleEvent(event: FSExtEvent) {
    if (this.busy) return;
    this.cache[this.cache.isProcessing ? 'buffer' : 'events'].push(event);
    this.busy = this.burstProtection(this.cache);
    this.process();
  }
  burstProtection(cache: EventCache) {
    const threshold = parseInt(process.env.EVENT_QUEUE_SIZE || '100');
    if (cache.events.length >= threshold || cache.buffer.length >= threshold) {
      const paths = new Set<string>();
      const uids = new Set<string>();
      let events: FSExtEvent[];
      if (cache.events.length >= threshold) events = cache.events;
      else events = cache.buffer;
      for (const event of events) {
        paths.add(event.watchedPath);
        event.uids.forEach((uid) => uids.add(uid));
      }
      const blockedPath = this.commonParent(Array.from(paths));
      for (const uid of uids) {
        this.redis.emit<any, ServiceEvent<SocketSend<FSBlock>>>('socket.send', {
          payload: { uid, pattern: 'fs', msg: { action: 'block', path: blockedPath } },
        });
      }
      return { uids: Array.from(uids), path: blockedPath };
    }
    return null;
  }
  async _process() {
    if (this.busy) {
      for (const uid of this.busy.uids) {
        this.redis.emit<any, ServiceEvent<SocketSend<FSResume>>>('socket.send', {
          payload: { uid, pattern: 'fs', msg: { action: 'resume', path: this.busy.path } },
        });
      }
      this.busy = null;
      return;
    }
    this.cache.isProcessing = true;
    await this.sync(this.cache.events);
    this.cache.events = this.cache.buffer;
    this.cache.buffer = [];
    this.cache.isProcessing = false;
  }
  async sync(events: FSExtEvent[]) {
    const uidEvents = new Map<string, FSEvent[]>();
    for (const event of events) {
      const doc = this.syncService.docs.get(event.path);
      if (event.type === 'file' && event.action === 'write' && doc) {
        console.log('yup');
        const fileHash = await this.syncService.getHashFromFile(event.path);
        const docHash = doc.computeHash();
        if (fileHash === docHash) {
          continue;
        }
      }

      for (const uid of event.uids) {
        if (!uidEvents.has(uid)) uidEvents.set(uid, []);
        this.cleanPaths(event);
        uidEvents.get(uid)?.push({
          action: event.action,
          path: event.path,
          timestamp: event.timestamp,
          watchedPath: event.watchedPath,
          ino: event.ino,
          oldPath: event.oldPath,
          type: event.type,
        });
      }
    }
    for (const uid of uidEvents.keys()) {
      this.redis.emit<any, ServiceEvent<SocketSend<FSEventBatch>>>('socket.send', {
        payload: { uid, pattern: 'fs', msg: { action: 'batch', events: uidEvents.get(uid) || [] } },
      });
    }
  }
  cleanPaths(event: FSExtEvent) {
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

  handleHeartbeat(_uid: string) {
    this.setIdleTimeout();
  }
  handleCold() {
    this.dispose();
    this.redis.emit('provisioner.deprovision', { uuid: process.env.WS_UUID! });
  }
  dispose() {
    this.syncService.dispose();
    // TODO
  }
}
