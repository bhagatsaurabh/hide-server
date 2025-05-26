import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filter/http-exception.filter';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RedisRef } from './common/refs/redis.ref';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN || '*' });
  app.useGlobalFilters(new HttpExceptionFilter());
  const microservice = app.connectMicroservice<MicroserviceOptions>({
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
      queue: 'env',
    },
  });

  await app.startAllMicroservices();
  RedisRef.set(microservice.unwrap());
  await app.listen(process.env.PORT ?? 80);
}

void bootstrap();
