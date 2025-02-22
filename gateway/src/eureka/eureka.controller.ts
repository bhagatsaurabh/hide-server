import { Controller, Get } from '@nestjs/common';

@Controller()
export class EurekaController {
  @Get('/health')
  getHealthCheck() {
    return { status: 'UP' };
  }
}
