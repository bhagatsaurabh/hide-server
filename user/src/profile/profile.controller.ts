import { Body, Controller, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { type User } from 'hide-common/dto/user';
import { UserHeader } from 'hide-common';
import { ProfileService } from './profile.service';
import { CreateUserDTO } from 'src/common/dto';

@Controller('api')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('register')
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@UserHeader() user: User, @Body() data: CreateUserDTO) {
    await this.profileService.createUser(user, data);
  }

  @Patch('update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(@UserHeader() userHeader: User, @Body() user: Partial<User>) {
    await this.profileService.updateUser(userHeader.uid, user);
  }
}
