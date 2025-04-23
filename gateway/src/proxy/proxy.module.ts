import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { SharedModule } from 'src/common/shared.module';
import { SocketModule } from 'src/socket/socket.module';

@Module({
  imports: [SharedModule, SocketModule],
  controllers: [ProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
