import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { UserHeader } from 'hide-common';
import { User } from 'hide-common/dto/user';
import { CreateDTO } from 'src/common/dto/create.dto';
import { ManageService } from './manage.service';
import { UpdateDTO } from 'src/common/dto/update.dto';

@Controller('api')
export class ManageController {
  constructor(private readonly service: ManageService) {}

  @Post('create')
  @HttpCode(HttpStatus.NO_CONTENT)
  async create(@UserHeader() user: User, @Body() data: Partial<CreateDTO>) {
    await this.service.createWorkspace(user.uid, data);
  }

  @Patch('update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(@UserHeader() user: User, @Body() data: Partial<UpdateDTO>) {
    await this.service.updateWorkspace(user.uid, data);
  }

  @Get('all')
  async all(@UserHeader() user: User) {
    return await this.service.getAllWorkspaces(user);
  }

  @Get(':workspaceUUID/check-membership')
  @HttpCode(HttpStatus.NO_CONTENT)
  async checkMembership(@Param('workspaceUUID') workspaceUUID: string, @UserHeader() user: User) {
    await this.service.isUserMemberOf(user.uid, workspaceUUID);
  }
}
