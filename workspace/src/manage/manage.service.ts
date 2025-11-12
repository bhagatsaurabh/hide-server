import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Equal, Not, Or, Repository } from 'typeorm';
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
  AccessRequestPayload,
  AccessStatus,
  CachedPresence,
  CACHEKEY_PRESENCE,
  CACHEKEY_PRESENCE_WORKSPACE,
  CACHEKEY_USER_PROFILE,
  CACHEKEY_WORKSPACE,
  createMessage,
  ExclusionData,
  MembersModified,
  NotificationRead,
  NotifyUser,
  ServiceEvent,
  ServiceMessage,
  ServicePayload,
  SocketSend,
  userConverter,
  UserProfileRequest,
  WorkspaceAccessRequest,
  WorkspaceDeleted,
  WorkspaceDowngraded,
  WorkspaceStatus,
} from 'hide-common';
import { randomUUID } from 'node:crypto';
import { Cache, RedisService } from 'hide-redis';
import { firstValueFrom } from 'rxjs';
import { FirebaseService, FirestoreService } from 'hide-firebase';
import { AccessDTO } from 'src/common/dto/access.dto';
import { AccessCode } from 'src/common/model/access-codes.entity';
import { sign, verify } from 'jsonwebtoken';
import { EmailService } from './email.service';
import { accessCode } from 'src/utils';
import { JWTSignFn, JWTVerifyFn } from 'src/utils/types';
import { loadK8sConfig } from 'src/common/config/k8s';
import { ObjectCoreV1Api } from '@kubernetes/client-node/dist/gen/types/ObjectParamAPI';

@Injectable()
export class ManageService implements OnModuleInit {
  cache: Cache;
  k8sApi: ObjectCoreV1Api;

  constructor(
    @InjectRepository(Workspace) private wsRepository: Repository<Workspace>,
    @InjectRepository(Membership) private msRepository: Repository<Membership>,
    @InjectRepository(AccessCode) private accessRepository: Repository<AccessCode>,
    @Inject('WORKSPACE_SERVICE_REDIS') private redis: ClientProxy,
    @Inject('WORKSPACE_SERVICE_NATS') private nats: ClientProxy,
    @Inject('WORKSPACE_SERVICE_RMQ') private rmq: ClientProxy,
    private readonly firestore: FirestoreService,
    private readonly inviteService: InviteService,
    private dataSource: DataSource,
    private cacheService: RedisService,
    private firebaseService: FirebaseService,
    private emailService: EmailService,
  ) {
    this.cache = this.cacheService.get();
  }

  onModuleInit() {
    if (process.env.DEV_PLATFORM_SIMULATE) return;

    this.k8sApi = loadK8sConfig();
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

    // Notify
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
    return { image: workspace.image, dedicated: workspace.dedicated };
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

  async deleteOwnedWorkspaces(uid: string) {
    const workspaces = await this.wsRepository
      .createQueryBuilder('workspace')
      .innerJoin('workspace.memberships', 'filterMembership', 'filterMembership.user_id = :userId', {
        userId: uid,
      })
      .leftJoinAndSelect('workspace.memberships', 'membership')
      .getMany();

    const ownedWorkspaces = workspaces.filter(
      (workspace) =>
        !!workspace.memberships.find(
          (membership) => membership.userId === uid && membership.role === 'owner',
        ),
    );
    const memberWorkspaces = workspaces.filter(
      (workspace) =>
        !!workspace.memberships.find(
          (membership) => membership.userId === uid && membership.role === 'member',
        ),
    );

    // Delete all owned workspaces
    await Promise.allSettled(
      ownedWorkspaces.map((ownedWorkspace) => this.deleteWorkspace(uid, ownedWorkspace.uuid)),
    );

    // Delete all memberships
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.delete(Membership, { userId: uid });
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Notify
    for (const memberWorkspace of memberWorkspaces) {
      const mbrs = new Set(memberWorkspace.memberships.map((membership) => membership.userId));
      mbrs.delete(uid);
      const mbrsToNotify = [...mbrs];
      const presences = await Promise.all(
        mbrsToNotify.map((userId) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(userId))),
      );
      mbrsToNotify.forEach((userId, idx) => {
        const presence = presences[idx];
        if (!presence) return;
        Object.keys(presence).forEach((sessionId) => {
          this.redis.emit<any, ServiceEvent<SocketSend<'workspace'>>>('socket.send', {
            meta: { uid: userId, sessionId },
            payload: {
              pattern: 'workspace',
              uid: userId,
              sessionId,
              msg: { action: 'members.modified', payload: { uuid: memberWorkspace.uuid } },
            },
          });
        });
      });
      this.redis.emit<any, ServiceEvent<MembersModified>>('workspace.members.modified', {
        payload: { uuid: memberWorkspace.uuid, added: [], removed: [uid] },
      });
    }

    return { ok: true };
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

  async createAccessRequest(user: User, req: AccessDTO) {
    const activeCount = await this.accessRepository.count({
      where: { uid: user.uid, status: Or(Equal(AccessStatus.UNUSED), Equal(AccessStatus.NEW)) },
    });
    if (activeCount) {
      throw new BadRequestException('ACCESS_CODE_LIMIT');
    }

    if (!(await this.canProvision())) {
      throw new ForbiddenException('NO_CAPACITY');
    }

    const profile = await this.getUserProfile(user.uid);
    const payload: AccessRequestPayload = {
      uid: user.uid,
      username: profile?.username ?? 'Unknown',
      name: profile?.name ?? 'Unknown',
      reason: req.reason,
      uuid: randomUUID(),
    };
    const token = (sign as JWTSignFn<ServicePayload<AccessRequestPayload>>)(
      { iss: 'workspace-api', aud: 'client', sub: 'dedicated-workspace', data: payload },
      process.env.WORKSPACE_SERVICE_SECRET!,
    );
    await this.emailService.sendAccessRequestEmail(process.env.ADMIN_EMAIL!, payload, token);

    let days = parseInt(process.env.ACCESS_CODE_EXPIRY_DAYS ?? '5');
    if (isNaN(days)) days = 5;
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(now.getDate() + days);
    const newAccessCode = new AccessCode({
      uid: user.uid,
      status: AccessStatus.NEW,
      code: accessCode(16),
      uuid: payload.uuid,
      expiresAt,
    });
    await this.accessRepository.save(newAccessCode);
  }

  async getUserProfile(uid: string) {
    let userProfile = await this.cache.get<User>(CACHEKEY_USER_PROFILE(uid));
    if (!userProfile) {
      const profileSnap = await this.firebaseService.firestore
        .collection('users')
        .withConverter(userConverter(this.firestore.Timestamp))
        .where('uid', '==', uid)
        .get();
      userProfile = profileSnap.docs.length > 0 ? profileSnap.docs[0].data() : undefined;
      if (userProfile) {
        await this.cache.set(CACHEKEY_USER_PROFILE(uid), userProfile);
      }
    }
    return userProfile;
  }

  async fulfillAccessRequest({ action, token }: { action: 'approve' | 'reject'; token: string }) {
    console.log('Fulfill access request:', action);
    let payload: ServicePayload<AccessRequestPayload>;
    try {
      payload = (verify as unknown as JWTVerifyFn<ServicePayload<AccessRequestPayload>>)(
        token,
        process.env.WORKSPACE_SERVICE_SECRET!,
      );
    } catch (error) {
      void error;
      throw new BadRequestException('BAD_TOKEN');
    }

    let code = '',
      success = false;
    if (action === 'reject') {
      await this.accessRepository.delete({ uuid: payload.data.uuid });
    } else {
      const accessCode = await this.accessRepository.findOne({ where: { uuid: payload.data.uuid } });
      if (!accessCode) {
        throw new BadRequestException('NOT_FOUND');
      }
      code = accessCode.code;
      success = true;

      accessCode.status = AccessStatus.UNUSED;
      await this.accessRepository.save(accessCode);
    }

    const notificationId = randomUUID();
    const msg = createMessage<NotifyUser<WorkspaceAccessRequest>>(payload.data.uid, '', {
      uid: payload.data.uid,
      notification: {
        type: 'workspace-access-code',
        id: notificationId,
        success,
        code,
        reqId: payload.data.uuid,
        createdOn: new Date().toISOString(),
      },
    });

    this.rmq.emit<unknown, ServiceMessage<NotifyUser<WorkspaceAccessRequest>>>('notification.send', msg);
    console.log('Fulfill access request: Completed');
  }

  async canProvision() {
    if (process.env.DEV_PLATFORM_SIMULATE) {
      return process.env.DEV_PLATFORM_SIMULATE.split(',')[1] === 'true';
    }

    const totalDedicatedCount = await this.wsRepository.count({
      where: { dedicated: true, status: Not(WorkspaceStatus.DELETING) },
    });
    const unusedAccessCodeCount = await this.accessRepository.count({
      where: { status: AccessStatus.UNUSED },
    });

    let allocatableCpu: number = 0,
      requestedSysCpu: number = 0;
    try {
      const nodeRes = await this.k8sApi.listNode();
      if (!nodeRes.items.length) {
        console.error('No nodes in cluster');
        throw new InternalServerErrorException('UNKNOWN');
      }
      const node = nodeRes.items[0];
      allocatableCpu =
        parseInt(node.status?.allocatable?.cpu ?? '') * 1000 ||
        parseInt(node.status?.allocatable?.cpu?.replace('m', '') ?? '');
      if (!allocatableCpu || isNaN(allocatableCpu)) {
        console.error('Cannot get node allocatable');
        throw new InternalServerErrorException('UNKNOWN');
      }

      const res = await this.k8sApi.listNamespacedPod({
        namespace: 'default',
        labelSelector: 'wstype!=dedicated,wstype!=spot',
      });
      const pods = res.items;
      pods.forEach((pod) => {
        if (pod.status?.phase !== 'Running') {
          return;
        }

        for (const container of pod.spec?.containers ?? []) {
          const cpuReq = container.resources?.requests?.cpu;
          if (!cpuReq) continue;

          if (cpuReq.endsWith('m')) {
            requestedSysCpu += parseInt(cpuReq.replace('m', ''), 10);
          } else {
            requestedSysCpu += parseInt(cpuReq, 10) * 1000;
          }
        }
      });
    } catch (error) {
      console.error('Failed to get allocatable and requested capacity', error);
      throw new InternalServerErrorException('UNKNOWN');
    }

    let wsCpu = parseInt(process.env.WORKSPACE_CPU_REQUEST ?? '200');
    if (isNaN(wsCpu)) wsCpu = 200;

    let idleThresholdCpu = parseInt(process.env.IDLE_THRESHOLD_CPU ?? '350');
    if (isNaN(idleThresholdCpu)) idleThresholdCpu = 350;

    console.log('Total Dedicated Count: ', totalDedicatedCount);
    console.log('Unused Access Code Count: ', unusedAccessCodeCount);
    console.log('WS CPU: ', wsCpu);
    console.log('System Requested CPU: ', requestedSysCpu);
    console.log('Allocatable CPU: ', allocatableCpu);
    return (
      (totalDedicatedCount + unusedAccessCodeCount + 1) * wsCpu + requestedSysCpu <
      allocatableCpu - idleThresholdCpu
    );
  }

  async deleteAccessCode(user: User, uuid: string, ntfnId: string) {
    await this.accessRepository.delete({ uid: user.uid, uuid });

    const msg: ServiceMessage<NotificationRead> = createMessage(user.uid, '', {
      uid: user.uid,
      notificationId: ntfnId,
    });
    this.rmq.emit<ServiceMessage<NotificationRead>>('notification.read', msg);
  }

  async consumeAccessCode(user: User, code: string) {
    const accessCode = await this.accessRepository.findOne({ where: { uid: user.uid, code } });
    if (!accessCode) {
      throw new NotFoundException('ACCESS_CODE_INVALID');
    }
    if (accessCode.status === AccessStatus.USED) {
      throw new ForbiddenException('ACCESS_CODE_ALREADY_USED');
    }
    if (accessCode.expiresAt < new Date()) {
      throw new BadRequestException('ACCESS_CODE_EXPIRED');
    }

    const success = await this.markCodeAsUsed(user.uid, code);
    if (!success) {
      throw new ForbiddenException('ACCESS_CODE_IN_USE');
    }
    /* accessCode.status = AccessStatus.USED;
    await this.accessRepository.save(accessCode); */

    return { success: true };
  }

  async markCodeAsUsed(uid: string, code: string) {
    const result = await this.accessRepository
      .createQueryBuilder()
      .update(AccessCode)
      .set({
        status: AccessStatus.USED,
        usedAt: () => 'NOW()',
      })
      .where('uid = :uid', { uid })
      .andWhere('code = :code', { code })
      .returning(['uuid', 'uid'])
      .execute();

    return result.affected !== 0;
  }

  async resetAccessCode(user: User, code: string) {
    const accessCode = await this.accessRepository.findOne({ where: { uid: user.uid, code } });
    if (!accessCode) {
      throw new NotFoundException('ACCESS_CODE_INVALID');
    }
    if (accessCode.status !== AccessStatus.USED) {
      throw new BadRequestException('ACCESS_CODE_NOT_IN_USE');
    }

    accessCode.status = AccessStatus.UNUSED;
    await this.accessRepository.save(accessCode);

    return { success: true };
  }

  async downgradeWorkspace({ uid, uuid }: { uid: string; uuid: string }) {
    const notificationId = randomUUID();
    const msg = createMessage<NotifyUser<WorkspaceDowngraded>>(uid, '', {
      uid: uid,
      notification: {
        type: 'workspace-downgraded',
        id: notificationId,
        uuid,
        createdOn: new Date().toISOString(),
      },
    });
    this.rmq.emit<unknown, ServiceMessage<NotifyUser<WorkspaceDowngraded>>>('notification.send', msg);

    const workspace = await this.wsRepository.findOne({ where: { uuid } });
    if (!workspace) return;

    workspace.dedicated = false;
    await this.wsRepository.save(workspace);
  }
}
