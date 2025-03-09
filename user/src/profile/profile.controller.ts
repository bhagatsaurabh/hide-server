import { Body, Controller, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { type User } from 'hide-common/dto/user';
import { UserHeader } from 'src/common/decorators';
import { ProfileService } from './profile.service';

@Controller('api')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('register')
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@UserHeader() user: User) {
    await this.profileService.createUser(user);
  }

  @Patch('update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(@Body() user: Partial<User>, @UserHeader() userHeader: User) {
    await this.profileService.updateUser(userHeader.uid, user);
  }
}
