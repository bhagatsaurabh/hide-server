import { Injectable } from "@nestjs/common";
import { FieldValue, Firestore } from "firebase-admin/firestore";
import { FirebaseService } from "../firebase.service";

@Injectable()
export class FirestoreService {
  readonly db: Firestore;

  constructor(private readonly firebaseService: FirebaseService) {
    this.db = this.firebaseService.firestore;
  }

  public serverTimestamp() {
    return FieldValue.serverTimestamp();
  }
}
