import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from 'hide-redis';
import { CoreModule } from './core/core.module';
import { ProxyModule } from './proxy/proxy.module';
import { SocketModule } from './socket/socket.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule.register({ host: process.env.REDIS_HOST!, port: process.env.REDIS_PORT! }),
    CoreModule,
    ProxyModule,
    SocketModule,
  ],
})
export class AppModule {}
