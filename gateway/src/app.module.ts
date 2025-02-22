import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './core/core.module';
import { EurekaModule } from './eureka/eureka.module';

@Module({
  imports: [ConfigModule.forRoot(), CoreModule, EurekaModule],
})
export class AppModule {}
