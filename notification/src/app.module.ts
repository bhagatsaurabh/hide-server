import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FirebaseModule } from 'hide-firebase';
import { RedisModule } from 'hide-redis';
import { AppService } from './app.service';
import { AppController } from './app.controller';
import { SharedModule } from './common/shared.module';

@Module({
  imports: [
    SharedModule,
    ConfigModule.forRoot(),
    FirebaseModule.register({
      key: process.env.FIREBASE_EMULATION
        ? undefined
        : process.env.FIREBASE_KEY
          ? readFileSync(process.env.FIREBASE_KEY, 'utf-8')
          : Buffer.from(process.env.FIREBASE_KEY_BASE64!, 'base64').toString(),
      emulate: !!process.env.FIREBASE_EMULATION,
    }),
    RedisModule.register({ host: process.env.REDIS_HOST!, port: process.env.REDIS_PORT!, database: '1' }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
