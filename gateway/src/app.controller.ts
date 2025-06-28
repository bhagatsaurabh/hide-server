import { Controller } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { MembersModified, ServiceEvent, WorkspaceDeleted } from 'hide-common';
import { MembershipService } from './socket/membership.service';

@Controller()
export class AppController {
  constructor(private readonly membershipService: MembershipService) {}

  @EventPattern('workspace.members.modified', Transport.REDIS)
  async handleMembersModified(msg: ServiceEvent<MembersModified>) {
    await this.membershipService.handleMembersModified(msg.payload);
  }
  @EventPattern('workspace.deleted', Transport.REDIS)
  async handleWorkspaceDeleted(msg: ServiceEvent<WorkspaceDeleted>) {
    await this.membershipService.handleWorkspaceDeleted(msg.payload);
  }
}
