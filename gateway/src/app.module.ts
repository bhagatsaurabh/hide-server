import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from 'hide-redis';
import { CoreModule } from './core/core.module';
import { ProxyModule } from './proxy/proxy.module';
import { SocketModule } from './socket/socket.module';
import { AppController } from './app.controller';
import { PublicModule } from './public/public.module';
import { FirebaseModule } from 'hide-firebase';
import { HealthModule } from 'hide-health';
import { readFileSync } from 'node:fs';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.register({ host: process.env.REDIS_HOST!, port: process.env.REDIS_PORT!, database: '1' }),
    FirebaseModule.register({
      key: process.env.FIREBASE_EMULATION
        ? undefined
        : process.env.FIREBASE_KEY
          ? readFileSync(process.env.FIREBASE_KEY, 'utf-8')
          : Buffer.from(process.env.FIREBASE_KEY_BASE64!, 'base64').toString(),
      emulate: !!process.env.FIREBASE_EMULATION,
    }),
    CoreModule,
    ProxyModule,
    SocketModule,
    PublicModule,
    HealthModule.register(),
  ],
  controllers: [AppController],
})
export class AppModule {}
