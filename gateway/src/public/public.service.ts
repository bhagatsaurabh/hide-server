import { Firestore } from '@google-cloud/firestore';
import { Cache } from '@nestjs/cache-manager';
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { VerifyEmailDTO } from 'hide-common';
import { UserRegistered } from 'hide-common/dto/webhook';
import { FirestoreService } from 'hide-firebase';
import { RedisService } from 'hide-redis';
import Redis from 'ioredis';
import Redlock, { Lock } from 'redlock';
import { usernameRegex } from 'src/utils/constants';

@Injectable()
export class PublicService implements OnModuleInit, OnModuleDestroy {
  redis: Redis;
  db: Firestore;
  redlock: Redlock;
  cache: Cache;

  constructor(
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
      const lock = await this.redlock.acquire(['locks:usernames_bloom_init'], 120 * 1000);
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

    const existsInBloom = await this.bloomCheck('usernames', username.toLowerCase());
    if (!existsInBloom) {
      return { available: true };
    }

    const exists = (await this.db.collection('users').doc(username).get()).exists;
    return { available: !exists };
  }

  validateUsername(username: string) {
    return username && usernameRegex.test(username);
  }

  async addUsername(username: string) {
    await this.bloomAdd('usernames', username.toLowerCase());
  }

  async bloomCheck(filter: string, value: string): Promise<boolean> {
    const res = await this.redis.call('BF.EXISTS', filter, value);
    return res === 1;
  }
  async bloomAdd(filter: string, value: string): Promise<void> {
    await this.redis.call('BF.ADD', filter, value);
  }
  async bloomReserve(filter: string, errorRate = 0.01, capacity = 10000) {
    await this.redis.call('BF.RESERVE', filter, errorRate, capacity);
  }
  async seed(lock: Lock) {
    const exists = await this.redis.exists('usernames');
    if (!exists) {
      await this.bloomReserve('usernames', 0.01, 100_000);
    }

    try {
      const docRefs = await this.db.collection('users').listDocuments();
      const usernames = docRefs.map((ref) => ref.id);
      await Promise.all(usernames.map((username) => this.bloomAdd('usernames', username)));

      await lock.release();
      console.log('[BloomInit] "usernames" populated');
    } catch (err) {
      console.error('[BloomInit] "usernames" failed', err);
    }
  }
  async refreshProfileCheckCache(data: UserRegistered) {
    const isProfileCreated = await this.cache.get<boolean>(`profile:${data.uid}`);
    if (isProfileCreated !== null && isProfileCreated === false) {
      await this.cache.set(`profile:${data.uid}`, true);
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
}
