import { Module } from '@nestjs/common';
import { EurekaService } from './eureka.service';
import { EurekaController } from './eureka.controller';

@Module({
  providers: [EurekaService],
  controllers: [EurekaController],
})
export class EurekaModule {}
