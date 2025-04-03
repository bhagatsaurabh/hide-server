import { Membership } from '../model/membership.entity';
import { Workspace } from '../model/workspace.entity';

export interface WorkspaceDTO extends Workspace {
  name: string;
  description: string;
  memberships: MembershipDTO[];
}

export interface MembershipDTO extends Membership {
  name?: string;
  username?: string;
  picture?: string;
}
