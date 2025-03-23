import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { SharedModule } from '../common/shared.module';

@Module({
  imports: [SharedModule],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
