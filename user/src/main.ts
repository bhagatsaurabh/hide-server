import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import Redis from 'ioredis';
import { RedisRef } from './common/redis-ref';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const micoservice = app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      host: process.env.REDIS_HOST!,
      port: parseInt(process.env.REDIS_PORT!),
    },
  });
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: [process.env.NATS_URL!],
      queue: 'user',
    },
  });

  await app.startAllMicroservices();
  RedisRef.set(micoservice.unwrap<[Redis, Redis]>());
  await app.listen(process.env.PORT ?? 80);
}

void bootstrap();
