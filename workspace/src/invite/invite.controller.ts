import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { InviteService } from './invite.service';
import { UserHeader } from 'hide-common';
import { User } from 'hide-common/dto/user';
import { InviteAllDTO, InviteDTO } from 'src/common/dto/invite.dto';
import { AcceptDTO } from 'src/common/dto/accept.dto';
import { IgnoreDTO } from 'src/common/dto/ignore.dto';

@Controller('api')
export class InviteController {
  constructor(private readonly service: InviteService) {}

  @Post('invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async invite(@UserHeader() user: User, @Body() data: InviteDTO) {
    await this.service.inviteUser(user.uid, data);
  }

  @Post('invite-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async inviteAll(@UserHeader() user: User, @Body() data: InviteAllDTO) {
    await this.service.inviteAllUsers(user.uid, data);
  }

  @Post('accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(@UserHeader() user: User, @Body() data: AcceptDTO) {
    await this.service.acceptInvitation(user.uid, data);
  }

  @Post('ignore')
  @HttpCode(HttpStatus.NO_CONTENT)
  ignore(@UserHeader() user: User, @Body() data: IgnoreDTO) {
    this.service.ignoreInvitation(user.uid, data);
  }
}
