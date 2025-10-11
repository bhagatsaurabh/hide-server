import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { PublicGuard } from 'src/common/guard/public.guard';
import { SharedModule } from 'src/common/shared.module';

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
    SharedModule,
  ],
  controllers: [PublicController],
  providers: [PublicService, PublicGuard],
})
export class PublicModule {}
