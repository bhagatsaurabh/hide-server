import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany, Generated } from 'typeorm';
import { Membership } from './membership.entity';

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
  }

  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'uuid', unique: true })
  @Generated('uuid')
  uuid: string;

  @Column({ nullable: false, length: 30 })
  name: string;

  @Column({ nullable: false, type: 'text' })
  description: string;

  @CreateDateColumn({ nullable: false, name: 'created_at', type: 'timestamptz' })
  createdAt: string;

  @OneToMany(() => Membership, (membership) => membership.workspace)
  memberships: Membership[];
}
