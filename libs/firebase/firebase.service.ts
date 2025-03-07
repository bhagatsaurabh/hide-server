import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { credential } from "firebase-admin";
import { App, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { getStorage, Storage } from "firebase-admin/storage";
import { FirebaseOptions } from "./firebase.module";

@Injectable()
export class FirebaseService implements OnModuleInit, OnModuleDestroy {
  readonly app: App;
  readonly firestore: Firestore;
  readonly storage: Storage;
  constructor(private readonly options: FirebaseOptions) {
    if (this.options.emulate) {
      this.app = initializeApp({ projectId: process.env.FIREBASE_APP_ID });
      console.log("Using firebase emulators");
    } else if (this.options.key) {
      this.app = initializeApp({
        credential: credential.cert(JSON.parse(this.options.key)),
      });
    } else {
      console.log("Error: Either use firebase emulators or pass a key");
    }

    this.firestore = getFirestore(this.app);
    this.storage = getStorage(this.app);
  }

  async onModuleInit() {}
  async onModuleDestroy() {}
}
