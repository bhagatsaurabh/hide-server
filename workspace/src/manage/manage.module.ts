import { Module } from '@nestjs/common';
import { ManageController } from './manage.controller';
import { ManageService } from './manage.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from 'src/common/model/workspace.entity';
import { Membership } from 'src/common/model/membership.entity';
import { InviteModule } from 'src/invite/invite.module';
import { SharedModule } from 'src/common/shared.module';
import { AccessCode } from 'src/common/model/access-codes.entity';
import { EmailService } from './email.service';

@Module({
  imports: [InviteModule, TypeOrmModule.forFeature([Workspace, Membership, AccessCode]), SharedModule],
  controllers: [ManageController],
  providers: [ManageService, EmailService],
})
export class ManageModule {}
