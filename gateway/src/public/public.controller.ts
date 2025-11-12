import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PublicService } from './public.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UsernameAvailabilityDTO } from 'hide-common/dto/user';
import { UserDeleted, UserRegistered, WebHookDTO } from 'hide-common/dto/webhook';
import { PublicGuard } from 'src/common/guard/public.guard';
import { RegisterEmailDTO, VerifyEmailDTO } from 'hide-common';
import { GuardParam } from 'src/common/decorator/public-guard.decorator';

@Controller('api')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get('check-username')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 1000, limit: 2 } })
  async checkUsername(@Query('username') username: string): Promise<UsernameAvailabilityDTO> {
    return await this.service.checkUsernameExistence(username);
  }

  @Post('register-email')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 1000, limit: 5 } })
  async registerEmail(@Body() data: RegisterEmailDTO): Promise<void> {
    return await this.service.registerEmail(data.email);
  }

  @Post('verify-email')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 1000, limit: 5 } })
  async verifyEmail(@Body() data: VerifyEmailDTO): Promise<{ token: string }> {
    return await this.service.verifyEmail(data);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 1000, limit: 3 } })
  @Get('templates')
  getLangs() {
    return this.service.getTemplates();
  }

  // Internal
  // Improvement: Network restrictions (IP ?)
  @Post('webhook')
  @UseGuards(PublicGuard)
  async handleWebhook(@Body() data: WebHookDTO<unknown>) {
    if (data.type === 'user.registered') {
      const payload = data.payload as UserRegistered;
      await this.service.addUsername(payload.username);
      await this.service.refreshProfileCheckCache(payload);
    } else if (data.type === 'user.deleted') {
      const payload = data.payload as UserDeleted;
      await this.service.removeUsername(payload.username);
      await this.service.removeCaches(payload.uid);
      await this.service.deleteOwnedWorkspaces(payload.uid);
    }
  }

  @Get('access-fulfill')
  @GuardParam({ publicGuardType: 'workspace' })
  @UseGuards(PublicGuard, ThrottlerGuard)
  @Throttle({ default: { ttl: 1000, limit: 1 } })
  async fulfillAccessRequest(@Query('action') action: 'approve' | 'reject', @Query('token') token: string) {
    await this.service.fulfillAccessRequest(action, token);
  }
}
