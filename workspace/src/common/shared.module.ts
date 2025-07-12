import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { RmqModule } from 'hide-rmq';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'WORKSPACE_SERVICE_REDIS',
        transport: Transport.REDIS,
        options: {
          host: process.env.REDIS_HOST!,
          port: parseInt(process.env.REDIS_PORT!),
        },
      },
      {
        name: 'WORKSPACE_SERVICE_NATS',
        transport: Transport.NATS,
        options: {
          servers: [process.env.NATS_URL!],
        },
      },
    ]),
    RmqModule.forRoot({ urls: [process.env.RMQ_URL!], queueOptions: { durable: true } }),
  ],
  exports: [ClientsModule],
})
export class SharedModule {}
