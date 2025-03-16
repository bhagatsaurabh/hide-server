import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany, Generated } from 'typeorm';
import { Membership } from './membership.entity';

@Entity()
export class Workspace {
  constructor(data: { name?: string; description?: string } = {}) {
    this.name = data.name ?? this.name;
    this.description = data.description ?? this.description;
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
  createdAt: boolean;

  @OneToMany(() => Membership, (membership) => membership.workspace)
  memberships: Membership[];
}
