import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import { Workspace } from 'src/common/model/workspace.entity';
import { Membership } from 'src/common/model/membership.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Workspace, Membership])],
  controllers: [InviteController],
  providers: [InviteService],
})
export class InviteModule {}
