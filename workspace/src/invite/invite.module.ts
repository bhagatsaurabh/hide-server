import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import { Workspace } from 'src/common/model/workspace.entity';
import { Membership } from 'src/common/model/membership.entity';
import { SharedModule } from 'src/common/shared.module';
import { AccessCode } from 'src/common/model/access-codes.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Workspace, Membership, AccessCode]), SharedModule],
  controllers: [InviteController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
