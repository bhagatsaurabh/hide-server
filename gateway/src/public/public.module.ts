import { Module } from '@nestjs/common';
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
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
