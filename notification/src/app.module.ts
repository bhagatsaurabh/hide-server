import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EurekaModule } from 'hide-eureka';

@Module({
  imports: [
    ConfigModule.forRoot(),
    EurekaModule.register({
      host: process.env.EUREKA_HOST!,
      port: process.env.EUREKA_PORT!,
      serviceName: process.env.SERVICE_NAME!,
      servicePort: process.env.SERVICE_PORT!,
    }),
  ],
})
export class AppModule {}
