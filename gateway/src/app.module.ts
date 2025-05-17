import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from 'hide-redis';
import { CoreModule } from './core/core.module';
import { ProxyModule } from './proxy/proxy.module';
import { SocketModule } from './socket/socket.module';
import { AppController } from './app.controller';
import { PublicModule } from './public/public.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.register({ host: process.env.REDIS_HOST!, port: process.env.REDIS_PORT!, database: '1' }),
    CoreModule,
    ProxyModule,
    SocketModule,
    PublicModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
