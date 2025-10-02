import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany, Generated } from 'typeorm';
import { Membership } from './membership.entity';
import { WorkspaceStatus } from 'hide-common';

@Entity()
export class Workspace {
  constructor(data: Partial<Workspace> = {}) {
    if (data.name) {
      this.name = data.name;
    }
    if (data.description) {
      this.description = data.description;
    }
    if (data.uuid) {
      this.uuid = data.uuid;
    }
    if (data.image) {
      this.image = data.image;
    }
    if (data.status) {
      this.status = data.status;
    }
    if (typeof data.dedicated !== 'undefined') {
      this.dedicated = data.dedicated;
    } else {
      this.dedicated = false;
    }
  }

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', unique: true })
  @Generated('uuid')
  uuid: string;

  @Column({ nullable: false, length: 50 })
  image: string;

  @Column({ nullable: false, length: 30 })
  name: string;

  @Column({ nullable: false, type: 'text' })
  description: string;

  @Column({ nullable: false, length: 30 })
  status: WorkspaceStatus;

  @Column({ nullable: false })
  dedicated: boolean;

  @CreateDateColumn({ nullable: false, name: 'created_at', type: 'timestamptz' })
  createdAt: string;

  @OneToMany(() => Membership, (membership) => membership.workspace)
  memberships: Membership[];
}
