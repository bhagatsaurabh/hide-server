import { Module } from '@nestjs/common';
import { ManageController } from './manage.controller';
import { ManageService } from './manage.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from 'src/common/model/workspace.entity';
import { Membership } from 'src/common/model/membership.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Workspace, Membership])],
  controllers: [ManageController],
  providers: [ManageService],
})
export class ManageModule {}
