import { Controller, Post } from '@nestjs/common';
import { UserHeader } from 'src/common/decorators';
import { IUser } from 'src/common/models';

@Controller('api')
export class ProfileController {
  constructor() {}

  @Post('register')
  register(@UserHeader() user: IUser) {
    console.log(user);
    return null;
  }
}
