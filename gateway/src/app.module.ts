import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EurekaModule } from 'hide-eureka';
import { CoreModule } from './core/core.module';
import { ProxyModule } from './proxy/proxy.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    EurekaModule.register({
      host: process.env.EUREKA_HOST!,
      port: process.env.EUREKA_PORT!,
      serviceName: process.env.SERVICE_NAME!,
      servicePort: process.env.SERVICE_PORT!,
    }),
    CoreModule,
    ProxyModule,
  ],
})
export class AppModule {}
