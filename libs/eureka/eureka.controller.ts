import { Controller, Get } from "@nestjs/common";

@Controller("api")
export class EurekaController {
  constructor() {}

  @Get("health")
  getHealthCheck() {
    return { status: "UP" };
  }
}
