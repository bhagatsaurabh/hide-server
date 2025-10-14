import { Injectable } from "@nestjs/common";
import { firestore } from "firebase-admin";
import { FirebaseService } from "../firebase.service";
import { Timestamp } from "firebase-admin/firestore";

@Injectable()
export class FirestoreService {
  readonly db: firestore.Firestore;
  readonly Timestamp: { fromDate: (d: Date) => any };

  constructor(private readonly firebaseService: FirebaseService) {
    this.db = this.firebaseService.firestore;
    this.Timestamp = Timestamp;
  }

  public serverTimestamp() {
    return firestore.FieldValue.serverTimestamp();
  }
}
