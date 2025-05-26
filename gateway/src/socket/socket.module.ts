import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { SharedModule } from '../common/shared.module';
import { CommonService } from './membership';
import { SocketController } from './socket.controller';

@Module({
  imports: [SharedModule],
  controllers: [SocketController],
  providers: [SocketGateway, CommonService],
  exports: [SocketGateway, CommonService],
})
export class SocketModule {}
