import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { SharedModule } from 'src/common/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [ProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
