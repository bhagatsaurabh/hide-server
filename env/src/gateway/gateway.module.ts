import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { FSService } from './fs.service';
import { SyncService } from './sync.service';
import { SharedModule } from 'src/common/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [GatewayController],
  providers: [FSService, SyncService],
})
export class GatewayModule {}
