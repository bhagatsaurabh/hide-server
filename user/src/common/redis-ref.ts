import Redis from 'ioredis';

export class RedisRef {
  private static redisServer: [Redis, Redis];

  static set(server: [Redis, Redis]) {
    this.redisServer = server;
  }

  static get(): [Redis, Redis] {
    return this.redisServer;
  }
}
