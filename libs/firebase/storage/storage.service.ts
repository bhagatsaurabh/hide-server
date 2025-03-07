import { Injectable } from "@nestjs/common";
import { Storage } from "firebase-admin/storage";
import { FirebaseService } from "../firebase.service";

@Injectable()
export class StorageService {
  readonly storage: Storage;

  constructor(private readonly firebaseService: FirebaseService) {
    this.storage = this.firebaseService.storage;
  }
}
