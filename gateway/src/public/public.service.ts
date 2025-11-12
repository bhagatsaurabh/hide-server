import { Cache } from '@nestjs/cache-manager';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CachedPresence,
  CACHEKEY_MEMBERSHIP,
  CACHEKEY_PRESENCE,
  CACHEKEY_PRESENCE_SESSION,
  CACHEKEY_USER_PROFILE,
  ServiceMessage,
  VerifyEmailDTO,
  WorkspaceDeleteOwned,
} from 'hide-common';
import { UserRegistered } from 'hide-common/dto/webhook';
import { User } from 'hide-common/model/user';
import { FirestoreService } from 'hide-firebase';
import { firestore } from 'firebase-admin';
import { RedisService } from 'hide-redis';
import Redis from 'ioredis';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Redlock, { Lock } from 'redlock';
import { firstValueFrom } from 'rxjs';
import { usernameRegex } from 'src/utils/constants';

@Injectable()
export class PublicService implements OnModuleInit, OnModuleDestroy {
  redis: Redis;
  db: firestore.Firestore;
  redlock: Redlock;
  cache: Cache;

  constructor(
    @Inject('GATEWAY_SERVICE_RMQ') private rmq: ClientProxy,
    private readonly firestore: FirestoreService,
    private readonly cacheService: RedisService,
  ) {
    this.db = this.firestore.db;
    this.cache = this.cacheService.get();
  }

  async onModuleInit() {
    this.redis = new Redis(parseInt(process.env.REDIS_PORT!), process.env.REDIS_HOST!);
    this.redlock = new Redlock([this.redis], { retryCount: 0 });

    try {
      const lock = await this.redlock.acquire(['locks:usernames_cuckoo_init'], 120 * 1000);
      await this.seed(lock);
    } catch (error) {
      void error;
    }
  }
  onModuleDestroy() {
    this.redis.disconnect();
  }

  async checkUsernameExistence(username: string) {
    if (!this.validateUsername(username)) {
      throw new BadRequestException('Not a valid username');
    }

    const existsInFilter = await this.cuckooCheck('usernames', username.toLowerCase());
    if (!existsInFilter) {
      return { available: true };
    }

    const exists = (await this.db.collection('users').doc(username).get()).exists;
    return { available: !exists };
  }

  validateUsername(username: string) {
    return username && usernameRegex.test(username);
  }

  async addUsername(username: string) {
    await this.cuckooAdd('usernames', username.toLowerCase());
  }
  async removeUsername(username: string) {
    await this.cuckooRemove('usernames', username.toLowerCase());
  }

  async cuckooCheck(filter: string, value: string): Promise<boolean> {
    const res = await this.redis.call('CF.EXISTS', filter, value);
    return res === 1;
  }
  async cuckooAdd(filter: string, value: string): Promise<void> {
    await this.redis.call('CF.ADD', filter, value);
  }
  async cuckooRemove(filter: string, value: string): Promise<void> {
    await this.redis.call('CF.DEL', filter, value);
  }
  async cuckooReserve(filter: string, capacity = 10000) {
    await this.redis.call('CF.RESERVE', filter, capacity);
  }
  async seed(lock: Lock) {
    const exists = await this.redis.exists('usernames');
    if (!exists) {
      await this.cuckooReserve('usernames', 100_000);
    }

    try {
      const docRefs = await this.db.collection('users').listDocuments();
      const usernames = docRefs.map((ref) => ref.id);
      await Promise.all(usernames.map((username) => this.cuckooAdd('usernames', username)));

      await lock.release();
      console.log('[FilterInit] "usernames" populated');
    } catch (err) {
      console.error('[FilterInit] "usernames" failed', err);
    }
  }
  async refreshProfileCheckCache(data: UserRegistered) {
    const userProfile = await this.cache.get<User>(CACHEKEY_USER_PROFILE(data.uid));
    if (!userProfile) {
      await this.cache.set(CACHEKEY_USER_PROFILE(data.uid), data);
    }
  }

  async registerEmail(email: string) {
    let response: Response;
    try {
      response = await fetch('http://auth/api/register-email', {
        method: 'POST',
        body: JSON.stringify({ email }),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Unknown error');
    }

    if (response.status < 200 || response.status > 299) {
      const data = (await response.json()) as { message: string };
      throw new HttpException(data.message ?? 'UNKNOWN', response.status);
    }
  }

  async verifyEmail(data: VerifyEmailDTO) {
    let response: Response;
    try {
      response = await fetch('http://auth/api/verify-email', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Unknown error');
    }

    if (response.status < 200 || response.status > 299) {
      const data = (await response.json()) as { message: string };
      throw new HttpException(data.message ?? 'UNKNOWN', response.status);
    }
    return (await response.json()) as { token: string };
  }

  async getTemplates() {
    const cachedTemplates = await this.cache.get<{ image: string; name: string }[]>('templates');
    if (cachedTemplates) {
      return cachedTemplates;
    }

    let filePath: string;
    if (process.env.NODE_ENV === 'development') {
      filePath = join(process.cwd(), 'static', 'templates.json');
    } else {
      filePath = join(process.cwd(), 'gateway', 'dist', 'static', 'templates.json');
    }
    const data = readFileSync(filePath, 'utf-8');
    const templates = JSON.parse(data) as { image: string; name: string }[];
    await this.cache.set('templates', templates, 3600000);
    return templates;
  }

  async fulfillAccessRequest(action: 'approve' | 'reject', token: string) {
    let res: Response;
    try {
      console.log('Requesting service...');
      res = await fetch('http://workspace/api/access/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action, token }),
      });
    } catch (error) {
      console.log(error);
      return { success: false, error: 'UNKNOWN' };
    }

    if (!res.ok) {
      const err = (await res.json()) as { message: string };
      return { success: false, error: err.message };
    }

    return { success: true };
  }

  async removeCaches(uid: string) {
    await this.cache.del(CACHEKEY_MEMBERSHIP(uid));
    await this.cache.del(CACHEKEY_USER_PROFILE(uid));
    const presence = await this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid));
    if (presence) {
      await Promise.allSettled(
        Object.keys(presence).map((sessionId) => this.cache.del(CACHEKEY_PRESENCE_SESSION(uid, sessionId))),
      );
      await this.cache.del(CACHEKEY_PRESENCE(uid));
    }
  }

  async deleteOwnedWorkspaces(uid: string) {
    const observable = this.rmq.send<unknown, ServiceMessage<WorkspaceDeleteOwned>>(
      'workspace.delete.owned',
      {
        payload: { ownerUid: uid },
      },
    );
    await firstValueFrom(observable);
  }
}
