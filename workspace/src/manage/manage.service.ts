import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from 'hide-common/dto/user';
import { CreateDTO } from 'src/common/dto/create.dto';
import { Membership } from 'src/common/model/membership.entity';
import { Workspace } from 'src/common/model/workspace.entity';
import { nameRegex, roleLevels } from 'src/utils/constants';
import { UpdateDTO } from 'src/common/dto/update.dto';
import { MembershipDTO, WorkspaceDTO } from 'src/common/dto/workspace.dto';
import { InviteService } from 'src/invite/invite.service';
import { ClientProxy } from '@nestjs/microservices';
import {
  CachedPresence,
  CACHEKEY_PRESENCE,
  CACHEKEY_PRESENCE_WORKSPACE,
  CACHEKEY_WORKSPACE,
  createMessage,
  ExclusionData,
  MembersModified,
  NotifyUser,
  ServiceEvent,
  ServiceMessage,
  UserProfileRequest,
  WorkspaceDeleted,
} from 'hide-common';
import { randomUUID } from 'node:crypto';
import { RmqService } from 'hide-rmq';
import { Cache, RedisService } from 'hide-redis';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ManageService {
  cache: Cache;

  constructor(
    @InjectRepository(Workspace) private wsRepository: Repository<Workspace>,
    @InjectRepository(Membership) private msRepository: Repository<Membership>,
    private readonly rmq: RmqService,
    @Inject('WORKSPACE_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('WORKSPACE_SERVICE_NATS') private nats: ClientProxy,
    private readonly inviteService: InviteService,
    private dataSource: DataSource,
    private cacheService: RedisService,
  ) {
    this.cache = this.cacheService.get();
  }

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
      const res = this.nats.send<User, ServiceMessage<UserProfileRequest>>('user.profile', {
        meta: { uid: user.uid },
        payload: { uid: user.uid },
      });
      const profile = await firstValueFrom<User>(res);
      (savedMembership as MembershipDTO).name = profile.name;
      (savedMembership as MembershipDTO).username = profile.username;
      (savedMembership as MembershipDTO).picture = profile.picture;
      savedWorkspace.memberships = [savedMembership];
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      console.log(err);
      throw err;
    } finally {
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

    if (data.members) {
      const members = (await this.msRepository.find({ where: { workspaceId: data.id } })).map(
        (membership) => membership.userId,
      );
      const reqMembers = new Set(data.members);
      const actMembers = new Set(members);
      const added: string[] = [];
      const removed: string[] = [];
      for (const uid of reqMembers) {
        if (!actMembers.has(uid)) added.push(uid);
      }
      for (const uid of actMembers) {
        if (!reqMembers.has(uid)) removed.push(uid);
      }
      await this.updateMembers(uid, workspace, { added, removed });
    }

    await this.wsRepository.save(workspace);
  }

  async updateMembers(
    uid: string,
    workspace: Workspace,
    { added, removed }: { added: string[]; removed: string[] },
  ) {
    // Removed members
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      await Promise.all(
        removed.map((uid) => {
          return queryRunner.manager.delete(Membership, { workspaceId: workspace.id, userId: uid });
        }),
      );
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    for (const removedUid of removed) {
      const msg = createMessage<NotifyUser<ExclusionData>>(removedUid, '', {
        uid: removedUid,
        notification: {
          type: 'workspace-membership-removed',
          id: randomUUID(),
          actorId: uid,
          workspaceUUID: workspace.uuid,
        },
      });
      this.rmq.send<ServiceMessage<NotifyUser<ExclusionData>>>('notification.send', msg);
    }

    // Added members
    await this.inviteService.inviteAllUsers(uid, { inviteeIds: added, workspaceUUID: workspace.uuid });

    this.redis.emit<any, ServiceEvent<MembersModified>>('workspace.members.modified', {
      payload: { uuid: workspace.uuid, added, removed },
    });
  }

  async getAllWorkspaces(user: User) {
    const workspaces = await this.wsRepository
      .createQueryBuilder('workspace')
      .innerJoin('workspace.memberships', 'filterMembership', 'filterMembership.user_id = :userId', {
        userId: user.uid,
      })
      .leftJoinAndSelect('workspace.memberships', 'membership')
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
    return { image: workspace.image };
  }

  async deleteWorkspace(uid: string, workspaceUUID: string) {
    if (typeof workspaceUUID === 'undefined' || workspaceUUID === null) {
      throw new BadRequestException('Missing workspace uuid');
    }
    const workspace = await this.wsRepository.findOne({
      where: { uuid: workspaceUUID },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace with specified uuid not found');
    }
    const membership = await this.msRepository.findOne({ where: { workspaceId: workspace.id, userId: uid } });
    if (!membership) {
      throw new ForbiddenException('User is not a member of the workspace');
    }
    if (roleLevels[membership.role] < roleLevels['admin']) {
      throw new ForbiddenException('User does not have required permissions');
    }

    const members = (await this.msRepository.find({ where: { workspaceId: workspace.id } })).map(
      (membership) => membership.userId,
    );

    await this.clearCacheOnDelete(members, workspaceUUID);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.delete(Membership, { workspaceId: workspace.id });
      await queryRunner.manager.delete(Workspace, { uuid: workspaceUUID });
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.commitTransaction();
      await queryRunner.release();
    }

    void fetch(`http://provisioner/api/dispose?uuid=${workspaceUUID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    this.redis.emit<any, ServiceEvent<WorkspaceDeleted>>('workspace.deleted', {
      payload: { uuid: workspaceUUID, members },
    });
  }

  async clearCacheOnDelete(members: string[], wsUuid: string) {
    const uids = await Promise.allSettled(
      members.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    members.forEach((uid, idx) => {
      if (uids[idx].status === 'fulfilled' && uids[idx].value) {
        const presence = uids[idx].value;
        const entries = Object.entries(presence);
        const [sessionId, _session] = entries.find(([_, session]) => session.wsUuid === wsUuid) || [];
        if (sessionId) {
          void this.cache.del(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, wsUuid));
          delete presence[sessionId].wsUuid;
          void this.cache.set(CACHEKEY_PRESENCE(uid), presence);
        }
      }
    });
    await this.cache.del(CACHEKEY_WORKSPACE(wsUuid));
  }
}
