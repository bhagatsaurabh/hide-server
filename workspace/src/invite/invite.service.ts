import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  WorkspaceInvite,
  NotifyUser,
  createMessage,
  ServiceMessage,
  NotificationRead,
  CachedPresence,
  CACHEKEY_PRESENCE,
  ServiceEvent,
  SocketSend,
  ServicePayload,
} from 'hide-common';
import { InviteAllDTO, InviteDTO } from 'src/common/dto/invite.dto';
import { Workspace } from 'src/common/model/workspace.entity';
import { Membership } from 'src/common/model/membership.entity';
import { roleLevels } from 'src/utils/constants';
import { InvitationPayload, JWTSignFn, JWTVerifyFn } from 'src/utils/types';
import { AcceptDTO } from 'src/common/dto/accept.dto';
import { ClientProxy } from '@nestjs/microservices';
import { IgnoreDTO } from 'src/common/dto/ignore.dto';
import { RedisService, Cache } from 'hide-redis';

@Injectable()
export class InviteService {
  cache: Cache;

  constructor(
    @Inject('WORKSPACE_SERVICE_RMQ') private rmq: ClientProxy,
    @Inject('WORKSPACE_SERVICE_REDIS') private redis: ClientProxy,
    @InjectRepository(Workspace) private wsRepository: Repository<Workspace>,
    @InjectRepository(Membership) private msRepository: Repository<Membership>,
    private cacheService: RedisService,
  ) {
    this.cache = this.cacheService.get();
  }

  async inviteUser(
    inviterId: string,
    { inviteeId, workspaceUUID, sshKey }: InviteDTO,
    doValidate: boolean = true,
  ) {
    let err: HttpException | undefined;
    if (doValidate) {
      if ((err = await this.validateInvite(inviterId, workspaceUUID))) {
        throw err;
      }
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);

    const notificationId = randomUUID();
    const payload: InvitationPayload = {
      notificationId,
      inviterId,
      inviteeId,
      workspaceUUID,
      validTill: expiryDate.getTime(),
      sshKey,
    };
    const jwt = (sign as JWTSignFn<ServicePayload<InvitationPayload>>)(
      { sub: workspaceUUID, aud: 'client', iss: 'workspace-api', data: payload },
      process.env.WORKSPACE_SERVICE_SECRET!,
    );
    const msg = createMessage<NotifyUser<WorkspaceInvite>>(inviteeId, '', {
      uid: inviteeId,
      notification: {
        type: 'workspace-invite',
        id: notificationId,
        inviterId,
        workspaceUUID,
        token: jwt,
        createdOn: new Date().toISOString(),
      },
    });

    this.rmq.emit<unknown, ServiceMessage<NotifyUser<WorkspaceInvite>>>('notification.send', msg);
  }
  async inviteAllUsers(inviterId: string, { inviteeIds, workspaceUUID, sshKey }: InviteAllDTO) {
    let err: HttpException | undefined;
    if ((err = await this.validateInvite(inviterId, workspaceUUID))) {
      throw err;
    }

    await Promise.all(
      inviteeIds.map((inviteeId) => this.inviteUser(inviterId, { inviteeId, workspaceUUID, sshKey }, false)),
    );
  }

  async acceptInvitation(inviteeId: string, { token }: AcceptDTO) {
    const { err, payload } = this.validateAccept(inviteeId, token);
    if (err) {
      throw err;
    }

    const wrspc = (await this.wsRepository.findOne({ where: { uuid: payload.data.workspaceUUID } }))!;
    const members = (await this.msRepository.find({ where: { workspaceId: wrspc.id } })).map(
      (membership) => membership.userId,
    );

    const workspace = await this.wsRepository.findOne({ where: { uuid: payload.data.workspaceUUID } });
    if (!workspace) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND');
    }
    const newMembership = new Membership();
    newMembership.setData({ workspaceId: workspace.id, userId: payload.data.inviteeId, role: 'member' });
    await this.msRepository.save(newMembership);

    const msg: ServiceMessage<NotificationRead> = createMessage(payload.data.inviteeId, '', {
      uid: payload.data.inviteeId,
      notificationId: payload.data.notificationId,
    });
    this.rmq.emit<ServiceMessage<NotificationRead>>('notification.read', msg);

    const presences = await Promise.all(
      members.map((uid) => this.cache.get<CachedPresence>(CACHEKEY_PRESENCE(uid))),
    );
    members.forEach((uid, idx) => {
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

    return { sshKey: payload.data.sshKey };
  }

  ignoreInvitation(inviteeId: string, { token }: IgnoreDTO) {
    const { err, payload } = this.validateAccept(inviteeId, token);
    if (err) {
      throw err;
    }

    const msg: ServiceMessage<NotificationRead> = createMessage(payload.data.inviteeId, '', {
      uid: payload.data.inviteeId,
      notificationId: payload.data.notificationId,
    });
    this.rmq.emit<ServiceMessage<NotificationRead>>('notification.read', msg);
  }

  private async validateInvite(inviterId: string, workspaceUUID: string) {
    const workspace = await this.wsRepository.findOne({ where: { uuid: workspaceUUID } });
    if (!workspace) {
      return new BadRequestException('WORKSPACE_NOT_FOUND');
    }
    const membership = await this.msRepository.findOne({
      where: {
        workspaceId: workspace.id,
        userId: inviterId,
      },
    });
    if (!membership) {
      return new ForbiddenException('NO_WORKSPACE_MEMBERSHIP');
    }
    if (roleLevels[membership.role] < 1) {
      return new ForbiddenException('WORKSPACE_ACTION_NOT_AUTHORIZED');
    }
  }
  private validateAccept(inviteeId: string, token: string) {
    let err: HttpException | null = null;
    const payload = (verify as unknown as JWTVerifyFn<ServicePayload<InvitationPayload>>)(
      token,
      process.env.WORKSPACE_SERVICE_SECRET!,
    );
    if (!payload || inviteeId !== payload.data.inviteeId) {
      err = new BadRequestException('INVALID_INVITATION_TOKEN');
    }

    return { err, payload };
  }
}
