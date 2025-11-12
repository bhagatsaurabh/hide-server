import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MembershipCheck, ServiceMessage, UserHeader, WorkspaceDeleteOwned } from 'hide-common';
import { User } from 'hide-common/dto/user';
import { CreateDTO } from 'src/common/dto/create.dto';
import { ManageService } from './manage.service';
import { UpdateDTO, UpdateStatusDTO } from 'src/common/dto/update.dto';
import { MessagePattern, Transport } from '@nestjs/microservices';
import { AccessDTO } from 'src/common/dto/access.dto';

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

  @Get('check-eligibility')
  async checkEligibility(@UserHeader() user: User) {
    return await this.service.checkEligibility(user);
  }

  @Post('access/request')
  async createAccessRequest(@UserHeader() user: User, @Body() data: AccessDTO) {
    return await this.service.createAccessRequest(user, data);
  }

  @Post('access/fulfill')
  async fulfillAccessRequest(@Body() data: { action: 'approve' | 'reject'; token: string }) {
    return await this.service.fulfillAccessRequest(data);
  }

  @Post('access/consume')
  async consumeAccessCode(@UserHeader() user: User, @Body() data: { code: string }) {
    return await this.service.consumeAccessCode(user, data.code);
  }

  @Post('access/reset')
  async resetAccessCode(@UserHeader() user: User, @Body() data: { code: string }) {
    return await this.service.resetAccessCode(user, data.code);
  }

  @Delete('access/delete')
  async deleteAccess(@UserHeader() user: User, @Query('reqId') reqId?: string, @Query('code') code?: string) {
    return await this.service.deleteAccessCode(user, reqId, code);
  }

  @Post('downgrade')
  async downgradeWorkspace(@Body() data: { uid: string; uuid: string }) {
    return await this.service.downgradeWorkspace(data);
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

  @MessagePattern('workspace.delete.owned', Transport.RMQ)
  async handleWorkspaceDelete(msg: ServiceMessage<WorkspaceDeleteOwned>) {
    return await this.service.deleteOwnedWorkspaces(msg.payload.ownerUid);
  }
}
