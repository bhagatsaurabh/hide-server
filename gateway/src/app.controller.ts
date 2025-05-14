import { Controller } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { MembersModifiedMessage, WorkspaceDeletedMessage } from 'hide-common';
import { CommonService } from './socket/common.service';

@Controller()
export class AppController {
  constructor(private readonly commonService: CommonService) {}

  @EventPattern('workspace.members.modified', Transport.REDIS)
  async handleMembersModified(data: MembersModifiedMessage) {
    await this.commonService.handleMembersModified(data);
  }
  @EventPattern('workspace.deleted', Transport.REDIS)
  async handleWorkspaceDeleted(data: WorkspaceDeletedMessage) {
    await this.commonService.handleWorkspaceDeleted(data);
  }
}
