import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'USER_SERVICE_RMQ',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RMQ_URL!],
          exchange: 'hide-default',
          exchangeType: 'topic',
          wildcards: true,
        },
      },
      {
        name: 'USER_SERVICE_REDIS',
        transport: Transport.REDIS,
        options: {
          host: process.env.REDIS_HOST!,
          port: parseInt(process.env.REDIS_PORT!),
        },
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class SharedModule {}
