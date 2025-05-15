import { DynamicModule, Module } from "@nestjs/common";
import { RmqOptions } from "@nestjs/microservices";
import { RmqService } from "./rmq.service";

@Module({})
export class RmqModule {
  static forRoot(options: RmqOptions["options"]): DynamicModule {
    return {
      module: RmqModule,
      providers: [
        {
          provide: "RMQ_CONFIG",
          useValue: options,
        },
        RmqService,
      ],
      exports: [RmqService],
      global: true,
    };
  }
}
