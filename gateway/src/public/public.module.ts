import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { FirebaseModule } from 'hide-firebase';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 1000,
          limit: 2,
        },
      ],
    }),
    FirebaseModule.register({
      key: process.env.FIREBASE_EMULATION
        ? undefined
        : process.env.FIREBASE_KEY
          ? readFileSync(process.env.FIREBASE_KEY, 'utf-8')
          : Buffer.from(process.env.FIREBASE_KEY_BASE64!, 'base64').toString(),
      emulate: !!process.env.FIREBASE_EMULATION,
    }),
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
