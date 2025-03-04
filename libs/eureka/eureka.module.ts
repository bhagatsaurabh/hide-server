import { DynamicModule, Module } from "@nestjs/common";
import { EurekaService } from "./eureka.service";
import { EurekaController } from "./eureka.controller";

export interface EurekaOptions {
  host: string;
  port: string | number;
  serviceName: string;
  servicePort: string | number;
}

@Module({})
export class EurekaModule {
  static register(options: EurekaOptions): DynamicModule {
    return {
      module: EurekaModule,
      controllers: [EurekaController],
      providers: [
        {
          provide: EurekaService,
          useFactory: () => new EurekaService(options),
        },
      ],
      exports: [EurekaService],
      global: true,
    };
  }
}
