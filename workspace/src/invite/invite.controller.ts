import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { InviteService } from './invite.service';
import { UserHeader } from 'hide-common';
import { User } from 'hide-common/dto/user';
import { InviteDTO } from 'src/common/dto/invite.dto';
import { AcceptDTO } from 'src/common/dto/accept.dto';

@Controller('api')
export class InviteController {
  constructor(private readonly service: InviteService) {}

  @Post('invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async invite(@UserHeader() user: User, @Body() data: InviteDTO) {
    await this.service.inviteUser(user.uid, data);
  }

  @Post('accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(@UserHeader() user: User, @Body() data: AcceptDTO) {
    await this.service.acceptInvitation(user.uid, data);
  }
}
