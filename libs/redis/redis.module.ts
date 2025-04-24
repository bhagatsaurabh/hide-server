import { DynamicModule, Module } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { createKeyv } from "@keyv/redis";
import { RedisService } from "./redis.service";

export interface RedisOptions {
  host: string;
  port: string | number;
  database?: string;
}

@Module({})
export class RedisModule {
  static register(options: RedisOptions): DynamicModule {
    return {
      module: RedisModule,
      imports: [
        CacheModule.registerAsync({
          useFactory: async () => {
            let url: string;
            if (options.database) {
              url = `redis://${options.host}:${options.port}/${options.database}`;
            } else {
              url = `redis://${options.host}:${options.port}`;
            }
            return {
              stores: [createKeyv(url)],
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
