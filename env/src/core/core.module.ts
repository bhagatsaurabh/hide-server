import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { SharedModule } from 'src/common/shared.module';
import { SSHProxyService } from './sshproxy.service';
import { WorkspaceService } from './workspace.service';
import { FSService } from './fs.service';
import { SyncService } from './sync.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [SharedModule, HttpModule],
  controllers: [CoreController],
  providers: [SSHProxyService, WorkspaceService, FSService, SyncService],
})
export class CoreModule {}
