import { DynamicModule, Module } from "@nestjs/common";
import { FirebaseService } from "./firebase.service";

export interface FirebaseOptions {
  key?: string;
  emulate?: boolean;
}

@Module({})
export class FirebaseModule {
  static register(options: FirebaseOptions): DynamicModule {
    return {
      module: FirebaseModule,
      providers: [
        {
          provide: FirebaseService,
          useFactory: () => new FirebaseService(options),
        },
      ],
      exports: [FirebaseService],
      global: true,
    };
  }
}
