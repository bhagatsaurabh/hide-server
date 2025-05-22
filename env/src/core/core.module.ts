import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { SharedModule } from 'src/common/shared.module';
import { SSHProxyService } from './sshproxy.service';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [SharedModule],
  controllers: [CoreController],
  providers: [SSHProxyService, WorkspaceService],
})
export class CoreModule {}
