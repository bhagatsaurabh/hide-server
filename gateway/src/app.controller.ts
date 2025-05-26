import { Controller } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { MembersModified, ServiceEvent, WorkspaceDeleted } from 'hide-common';
import { CommonService } from './socket/membership';

@Controller()
export class AppController {
  constructor(private readonly commonService: CommonService) {}

  @EventPattern('workspace.members.modified', Transport.REDIS)
  async handleMembersModified(msg: ServiceEvent<MembersModified>) {
    await this.commonService.handleMembersModified(msg.payload);
  }
  @EventPattern('workspace.deleted', Transport.REDIS)
  async handleWorkspaceDeleted(msg: ServiceEvent<WorkspaceDeleted>) {
    await this.commonService.handleWorkspaceDeleted(msg.payload);
  }
}
