import { Entity, Column, PrimaryColumn, CreateDateColumn, ManyToOne, Index, JoinColumn } from 'typeorm';
import { Workspace } from './workspace.entity';

@Entity()
export class Membership {
  setData(data: Partial<Membership>) {
    if (data.workspaceId) {
      this.workspaceId = data.workspaceId;
    }
    if (data.userId) {
      this.userId = data.userId;
    }
    if (data.role) {
      this.role = data.role;
    }
  }

  @PrimaryColumn({ name: 'workspace_id', type: 'bigint' })
  @Index()
  workspaceId: number;

  @PrimaryColumn({ name: 'user_id', length: 64 })
  @Index()
  userId: string;

  @Column({ nullable: false, length: 25, default: 'member' })
  role: string;

  @CreateDateColumn({ name: 'joined_at', nullable: false, type: 'timestamptz' })
  joinedAt: boolean;

  @ManyToOne(() => Workspace, (workspace) => workspace.memberships)
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;
}
