import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { SharedModule } from '../common/shared.module';
import { SocketController } from './socket.controller';
import { MembershipService } from './membership.service';
import { PresenceService } from './presence.service';

@Module({
  imports: [SharedModule],
  controllers: [SocketController],
  providers: [SocketGateway, MembershipService, PresenceService],
  exports: [SocketGateway, MembershipService, PresenceService],
})
export class SocketModule {}
