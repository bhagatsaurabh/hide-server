import { AccessStatus } from 'hide-common';
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class AccessCode {
  constructor(data: Partial<AccessCode> = {}) {
    if (data.code) {
      this.code = data.code;
    }
    if (data.uid) {
      this.uid = data.uid;
    }
    if (data.usedAt) {
      this.usedAt = data.usedAt;
    }
    if (data.expiresAt) {
      this.expiresAt = data.expiresAt;
    }
    if (data.status) {
      this.status = data.status;
    }
    if (data.uuid) {
      this.uuid = data.uuid;
    }
  }

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: false, unique: true })
  code: string;

  @Column({ nullable: false, length: 64 })
  uid: string;

  @Column({ nullable: false, length: 64 })
  uuid: string;

  @Column({ nullable: false })
  status: AccessStatus;

  @Column({ name: 'used_at', nullable: true, type: 'timestamptz' })
  usedAt: Date;

  @Column({ name: 'expires_at', nullable: true, type: 'timestamptz' })
  expiresAt: Date;
}
