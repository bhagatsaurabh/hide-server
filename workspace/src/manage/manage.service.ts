import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from 'hide-common/dto/user';
import { CreateDTO } from 'src/common/dto/create.dto';
import { Membership } from 'src/common/model/membership.entity';
import { Workspace } from 'src/common/model/workspace.entity';
import { nameRegex, roleLevels } from 'src/utils/constants';
import { UpdateDTO } from 'src/common/dto/update.dto';
import { MembershipDTO, WorkspaceDTO } from 'src/common/dto/workspace.dto';

@Injectable()
export class ManageService {
  constructor(
    @InjectRepository(Workspace) private wsRepository: Repository<Workspace>,
    @InjectRepository(Membership) private msRepository: Repository<Membership>,
    private dataSource: DataSource,
  ) {}

  async createWorkspace(user: User, data: Partial<CreateDTO>) {
    let err: string | undefined;
    if ((err = this.validateCreation(data))) {
      throw new BadRequestException(err);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    let savedWorkspace: Workspace;
    try {
      const newWorkspace = new Workspace(data as CreateDTO);
      savedWorkspace = await queryRunner.manager.save<Workspace>(newWorkspace);

      const newMembership = new Membership();
      newMembership.setData({
        workspaceId: savedWorkspace.id,
        userId: user.uid,
        role: 'owner',
      });
      const savedMembership = await queryRunner.manager.save<Membership>(newMembership);
      (savedMembership as MembershipDTO).name = user.name;
      (savedMembership as MembershipDTO).username = user.username;
      (savedMembership as MembershipDTO).picture = user.picture;
      savedWorkspace.memberships = [savedMembership];
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.commitTransaction();
      await queryRunner.release();
    }
    return savedWorkspace;
  }
  private validateCreation(data: Partial<CreateDTO>) {
    if (!data.name || !nameRegex.test(data.name)) {
      return 'Not a valid workspace name';
    }
  }

  async updateWorkspace(uid: string, data: Partial<UpdateDTO>) {
    if (typeof data.id === 'undefined' || data.id === null) {
      throw new BadRequestException('Missing workspace id');
    }
    const membership = await this.msRepository.findOne({ where: { workspaceId: data.id, userId: uid } });
    if (!membership) {
      throw new ForbiddenException('User is not a member of the workspace');
    }
    if (roleLevels[membership.role] < roleLevels['admin']) {
      throw new ForbiddenException('User does not have required permissions');
    }
    const workspace = await this.wsRepository.findOne({ where: { id: data.id } });
    if (!workspace) {
      throw new NotFoundException('Workspace with specified id not found');
    }

    if (data.name) {
      let err: string | undefined;
      if ((err = this.validateCreation(data))) {
        throw new BadRequestException(err);
      }
      workspace.name = data.name;
    }
    if (typeof data.description === 'string') {
      workspace.description = data.description;
    }

    await this.wsRepository.save(workspace);
  }

  async getAllWorkspaces(user: User) {
    const workspaces = await this.wsRepository
      .createQueryBuilder('workspace')
      .innerJoinAndSelect('workspace.memberships', 'membership')
      .where('membership.user_id = :userId', { userId: user.uid })
      .getMany();

    const userIds: string[] = [];
    for (const workspace of workspaces) {
      userIds.push(...workspace.memberships.map((membership) => membership.userId));
    }
    const response = await fetch(`http://user/api/all`, {
      method: 'POST',
      body: JSON.stringify(userIds),
      headers: {
        'Content-Type': 'application/json',
        'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
      },
    });
    const profiles = (await response.json()) as User[];
    const profileMap: { [id: string]: User } = {};
    profiles.forEach((profile) => (profileMap[profile.uid] = profile));
    (workspaces as WorkspaceDTO[]).forEach((workspace) => {
      workspace.memberships.forEach((membership) => {
        const profile = profileMap[membership.userId];
        if (profile) {
          membership.name = profile.name;
          membership.username = profile.username;
          membership.picture = profile.picture;
        }
      });
    });
    return workspaces as WorkspaceDTO[];
  }

  async isUserMemberOf(uid: string, workspaceUUID: string) {
    const workspace = await this.wsRepository.findOne({
      where: { uuid: workspaceUUID },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    const membership = await this.msRepository.findOne({
      where: { workspaceId: workspace.id, userId: uid },
    });
    if (!membership) {
      throw new ForbiddenException('User is not a member of the workspace');
    }
    return true;
  }
}
