import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { EurekaModule } from 'hide-eureka';
import { FirebaseModule } from 'hide-firebase';
import { ProfileModule } from './profile/profile.module';
import { SearchModule } from './search/search.module';
import { RedisModule } from 'hide-redis';

@Module({
  imports: [
    ConfigModule.forRoot(),
    EurekaModule.register({
      host: process.env.EUREKA_HOST!,
      port: process.env.EUREKA_PORT!,
      serviceName: process.env.SERVICE_NAME!,
      servicePort: process.env.SERVICE_PORT!,
    }),
    FirebaseModule.register({
      key: process.env.FIREBASE_EMULATION
        ? undefined
        : process.env.FIREBASE_KEY
          ? readFileSync(process.env.FIREBASE_KEY, 'utf-8')
          : Buffer.from(process.env.FIREBASE_KEY_BASE64!, 'base64').toString(),
      emulate: !!process.env.FIREBASE_EMULATION,
    }),
    RedisModule.register({ host: process.env.REDIS_HOST!, port: process.env.REDIS_PORT! }),
    ProfileModule,
    SearchModule,
  ],
})
export class AppModule {}
