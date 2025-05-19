import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { RedisModule } from 'hide-redis';

@Module({
  imports: [
    CoreModule,
    RedisModule.register({ host: process.env.REDIS_HOST!, port: process.env.REDIS_PORT!, database: '1' }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
