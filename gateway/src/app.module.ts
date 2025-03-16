import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EurekaModule } from 'hide-eureka';
import { CoreModule } from './core/core.module';
import { ProxyModule } from './proxy/proxy.module';
import { SocketModule } from './socket/socket.module';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    ConfigModule.forRoot(),
    EurekaModule.register({
      host: process.env.EUREKA_HOST!,
      port: process.env.EUREKA_PORT!,
      serviceName: process.env.SERVICE_NAME!,
      servicePort: process.env.SERVICE_PORT!,
    }),
    ClientsModule.register([
      {
        name: 'GATEWAY_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RMQ_URL!],
          queue: 'default',
          queueOptions: {
            durable: false,
          },
        },
      },
    ]),
    CoreModule,
    ProxyModule,
    SocketModule,
  ],
})
export class AppModule {}
