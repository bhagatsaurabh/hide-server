import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RMQ_URL!],
      queue: 'workspace',
      queueOptions: {
        durable: true,
      },
      exchange: 'hide-default',
      exchangeType: 'topic',
      wildcards: true,
    },
  });

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 80);
}
void bootstrap();
