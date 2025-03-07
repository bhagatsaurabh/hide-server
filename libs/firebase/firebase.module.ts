import { DynamicModule, Module } from "@nestjs/common";
import { FirebaseService } from "./firebase.service";
import { FirestoreService } from "./firestore/firestore.service";
import { StorageService } from "./storage/storage.service";

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
        FirestoreService,
        StorageService,
      ],
      exports: [FirebaseService, FirestoreService, StorageService],
      global: true,
    };
  }
}
