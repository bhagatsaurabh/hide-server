import { Controller, Get } from "@nestjs/common";

@Controller("api")
export class HealthController {
  constructor() {}

  @Get("health")
  healthcheck() {
    return { status: "UP" };
  }
}
