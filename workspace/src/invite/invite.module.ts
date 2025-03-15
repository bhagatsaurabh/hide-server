import { Module } from '@nestjs/common';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';

@Module({
  imports: [],
  controllers: [InviteController],
  providers: [InviteService],
})
export class InviteModule {}
