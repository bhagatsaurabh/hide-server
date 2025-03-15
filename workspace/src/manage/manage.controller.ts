import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { UserHeader } from 'hide-common/decorator/user-header';
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

  @Get()
  async all(@UserHeader() user: User) {
    return await this.service.getAllWorkspaces(user.uid);
  }
}
