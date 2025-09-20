import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { FirebaseModule } from 'hide-firebase';
import { ProfileModule } from './profile/profile.module';
import { SearchModule } from './search/search.module';
import { RedisModule } from 'hide-redis';
import { HealthModule } from 'hide-health';

@Module({
  imports: [
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
    HealthModule.register(),
    ProfileModule,
    SearchModule,
  ],
})
export class AppModule {}
