import { DynamicModule, Module } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { createKeyv } from "@keyv/redis";
import { RedisService } from "./redis.service";

export interface RedisOptions {
  host: string;
  port: string | number;
}

@Module({})
export class RedisModule {
  static register(options: RedisOptions): DynamicModule {
    return {
      module: RedisModule,
      imports: [
        CacheModule.registerAsync({
          useFactory: async () => {
            return {
              stores: [createKeyv(`redis://${options.host}:${options.port}`)],
            };
          },
        }),
      ],
      providers: [RedisService],
      exports: [RedisService],
      global: true,
    };
  }
}
