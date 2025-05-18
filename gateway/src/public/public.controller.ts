import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PublicService } from './public.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UsernameAvailabilityDTO } from 'hide-common/dto/user';
import { UserRegistered, WebHookDTO } from 'hide-common/dto/webhook';

@Controller('api')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get('check-username')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 1000, limit: 2 } })
  async checkUsername(@Query('username') username: string): Promise<UsernameAvailabilityDTO> {
    return await this.service.checkUsernameExistence(username);
  }

  // TODO: Network restriction & service key
  @Post('webhook')
  async handleWebhook(@Body() data: WebHookDTO<unknown>) {
    if (data.type === 'user.registered') {
      const payload = data.payload as UserRegistered;
      await this.service.addUsername(payload.username);
      await this.service.refreshProfileCheckCache(payload);
    }
  }
}
