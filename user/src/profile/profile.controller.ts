import { Controller, Post, Res } from '@nestjs/common';
import { UserHeader } from 'src/common/decorators';
import { IUser } from 'src/common/models';
import { ProfileService } from './profile.service';
import { Response } from 'express';

@Controller('api')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('register')
  register(@Res() res: Response, @UserHeader() user: IUser) {
    this.profileService.createUser(user);
    res.status(204).send();
  }
}
