import { Entity, Column, PrimaryColumn, CreateDateColumn, ManyToOne, Index } from 'typeorm';
import { Workspace } from './workspace.entity';

@Entity()
export class Membership {
  constructor(data: { workspaceId: number; userId: string; role: string }) {
    this.workspaceId = data.workspaceId;
    this.userId = data.userId;
    this.role = data.role;
  }

  @PrimaryColumn({ name: 'workspace_id', type: 'bigint' })
  @Index()
  workspaceId: number;

  @PrimaryColumn({ length: 64 })
  @Index()
  userId: string;

  @Column({ nullable: false, length: 25, default: 'member' })
  role: string;

  @CreateDateColumn({ nullable: false, name: 'joined_at', type: 'timestamptz' })
  joinedAt: boolean;

  @ManyToOne(() => Workspace, (workspace) => workspace.memberships)
  workspace: Workspace;
}
