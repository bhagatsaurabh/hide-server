import { DynamicModule, Module } from "@nestjs/common";
import { HealthService } from "./health.service";
import { HealthController } from "./health.controller";

@Module({})
export class HealthModule {
  static register(): DynamicModule {
    return {
      module: HealthModule,
      imports: [],
      controllers: [HealthController],
      providers: [HealthService],
      exports: [HealthService],
      global: true,
    };
  }
}
