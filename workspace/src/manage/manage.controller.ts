import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { MembershipCheck, ServiceMessage, UserHeader } from 'hide-common';
import { User } from 'hide-common/dto/user';
import { CreateDTO } from 'src/common/dto/create.dto';
import { ManageService } from './manage.service';
import { UpdateDTO, UpdateStatusDTO } from 'src/common/dto/update.dto';
import { MessagePattern, Transport } from '@nestjs/microservices';

@Controller('api')
export class ManageController {
  constructor(private readonly service: ManageService) {}

  @Post('create')
  async create(@UserHeader() user: User, @Body() data: Partial<CreateDTO>) {
    return await this.service.createWorkspace(user, data);
  }

  @Delete(':workspaceUUID/delete')
  async delete(@Param('workspaceUUID') workspaceUUID: string, @UserHeader() user: User) {
    await this.service.deleteWorkspace(user.uid, workspaceUUID);
  }

  @Patch('update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(@UserHeader() user: User, @Body() data: Partial<UpdateDTO>) {
    await this.service.updateWorkspace(user.uid, data);
  }

  // Internal
  @Patch('update-status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateStatus(@Body() data: UpdateStatusDTO) {
    await this.service.updateWorkspaceStatus(data.uuid, data.status);
  }

  @Get('all')
  async all(@UserHeader() user: User) {
    return await this.service.getAllWorkspaces(user);
  }

  @Get(':workspaceUUID/check-membership')
  @HttpCode(HttpStatus.NO_CONTENT)
  async checkMembership(@Param('workspaceUUID') workspaceUUID: string, @UserHeader() user: User) {
    return await this.service.isUserMemberOf(user.uid, workspaceUUID);
  }

  @MessagePattern('workspace.membership.check', Transport.RMQ)
  async handleCheckMembership(msg: ServiceMessage<MembershipCheck>) {
    return await this.service.isUserMemberOf(msg.payload.uid, msg.payload.uuid);
  }
}
