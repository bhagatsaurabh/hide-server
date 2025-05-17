import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PublicService } from './public.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { ServiceMessage, UserRegistered } from 'hide-common';
import { UsernameAvailabilityDTO } from 'hide-common/dto/user';

@Controller('api')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get('check-username')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 1000, limit: 2 } })
  async checkUsername(@Query('username') username: string): Promise<UsernameAvailabilityDTO> {
    return await this.service.checkUsernameExistence(username);
  }

  @MessagePattern('user.registered', Transport.RMQ)
  async handleUserRegistered(@Payload() msg: ServiceMessage<UserRegistered>) {
    await this.service.addUsername(msg.payload.username);
  }
}
