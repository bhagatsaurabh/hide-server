import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
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
  SocketSend,
  UserProfileRequest,
  WorkspaceDeleted,
  WorkspaceStatus,
} from 'hide-common';
import { randomUUID } from 'node:crypto';
import { Cache, RedisService } from 'hide-redis';
import { firstValueFrom } from 'rxjs';
import { FirebaseService } from 'hide-firebase';

@Injectable()
export class ManageService {
  cache: Cache;

  constructor(
    @InjectRepository(Workspace) private wsRepository: Repository<Workspace>,
    @InjectRepository(Membership) private msRepository: Repository<Membership>,
    @Inject('WORKSPACE_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('WORKSPACE_SERVICE_NATS') private nats: ClientProxy,
    @Inject('WORKSPACE_SERVICE_RMQ') private rmq: ClientProxy,
    private readonly inviteService: InviteService,
    private dataSource: DataSource,
    private cacheService: RedisService,
    private firebaseService: FirebaseService,
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
      const newWorkspace = new Workspace({ ...data, status: WorkspaceStatus.READY });

      // Improvement: PROVISIONING status not used
      newWorkspace.status = WorkspaceStatus.READY;
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
      await this.updateMembers(uid, workspace, { added, removed }, data.sshKey!);
    }

    await this.wsRepository.save(workspace);
  }

  async updateWorkspaceStatus(uuid: string, status: WorkspaceStatus) {
    if (!uuid) {
      throw new BadRequestException('Missing workspace uuid');
    }
    const workspace = await this.wsRepository.findOne({ where: { uuid } });
    if (!workspace) {
      throw new NotFoundException('Workspace with specified uuid not found');
    }

    workspace.status = status;

    await this.wsRepository.save(workspace);
  }

  async updateMembers(
    uid: string,
    workspace: Workspace,
    { added, removed }: { added: string[]; removed: string[] },
    sshKey: string,
  ) {
    const members = (await this.msRepository.find({ where: { workspaceId: workspace.id } })).map(
      (membership) => membership.userId,
    );
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
          id: randomUUID(),
          type: 'workspace-membership-removed',
          actorId: uid,
          workspaceUUID: workspace.uuid,
          name: workspace.name,
          createdOn: new Date().toISOString(),
        },
      });
      this.rmq.emit<ServiceMessage<NotifyUser<ExclusionData>>>('notification.send', msg);
    }

    // Added members
    await this.inviteService.inviteAllUsers(uid, {
      inviteeIds: added,
      workspaceUUID: workspace.uuid,
      sshKey,
    });

    if (removed.length) {
      const mbrs = new Set(members);
      removed.forEach((uid) => mbrs.delete(uid));
      const mbrsToNotify = [...mbrs];
      const presences = await Promise.all(
        mbrsToNotify.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
      );
      mbrsToNotify.forEach((uid, idx) => {
        const presence = presences[idx];
        if (!presence) return;
        Object.keys(presence).forEach((sessionId) => {
          this.redis.emit<any, ServiceEvent<SocketSend<'workspace'>>>('socket.send', {
            meta: { uid, sessionId },
            payload: {
              pattern: 'workspace',
              uid,
              sessionId,
              msg: { action: 'members.modified', payload: { uuid: workspace.uuid } },
            },
          });
        });
      });
    }

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

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.delete(Membership, { workspaceId: workspace.id });
      await queryRunner.manager.delete(Workspace, { uuid: workspaceUUID });
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    await this.clearCacheOnDelete(members, workspaceUUID);

    void fetch(`http://provisioner/api/delete?uuid=${workspaceUUID}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    this.redis.emit<any, ServiceEvent<WorkspaceDeleted>>('workspace.deleted', {
      payload: { uuid: workspaceUUID, members },
    });
  }

  async clearCacheOnDelete(members: string[], wsUuid: string) {
    const presences = await Promise.allSettled(
      members.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    members.forEach((uid, idx) => {
      if (presences[idx].status === 'fulfilled' && presences[idx].value) {
        const presence = presences[idx].value;
        const entries = Object.entries(presence);
        const [sessionId, _session] = entries.find(([_, session]) => session.wsUuid === wsUuid) || [];
        if (sessionId) {
          this.redis.emit<unknown, ServiceEvent<SocketSend<'env'>>>('socket.send', {
            meta: { uid, sessionId },
            payload: {
              pattern: 'env',
              uid,
              sessionId,
              msg: { action: 'disconnect', payload: { code: 'WORKSPACE_DELETED' } },
            },
          });
          void this.cache.del(CACHEKEY_PRESENCE_WORKSPACE(uid, sessionId, wsUuid));
          delete presence[sessionId].wsUuid;
          void this.cache.set(CACHEKEY_PRESENCE(uid), presence);
        }
      }
    });
    await this.cache.del(CACHEKEY_WORKSPACE(wsUuid));
  }

  async checkEligibility(user: User) {
    let isGuest = true;
    const authUser = await this.firebaseService.auth.getUser(user.uid);
    isGuest = !authUser.providerData.length;

    let limit = isGuest
      ? parseInt(process.env.WORKSPACE_CREATION_LIMIT_GUEST!)
      : parseInt(process.env.WORKSPACE_CREATION_LIMIT_NON_GUEST!);
    if (isNaN(limit)) {
      limit = 1;
    }

    const existingCount = await this.wsRepository
      .createQueryBuilder('workspace')
      .innerJoin('workspace.memberships', 'filterMembership', 'filterMembership.user_id = :userId', {
        userId: user.uid,
      })
      .leftJoinAndSelect('workspace.memberships', 'membership')
      .getCount();

    if (existingCount >= limit) {
      throw new ForbiddenException('MAX_WORKSPACE_QUOTA_REACHED');
    }
  }
}
