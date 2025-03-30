import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filter/http-exception.filter';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN || '*' });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RMQ_URL!],
      queue: 'default',
      queueOptions: {
        durable: false,
      },
    },
  });
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 80);
}
bootstrap();
