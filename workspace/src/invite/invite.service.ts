import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkspaceInvite, NotifyUser, createMessage, ServiceMessage, NotificationRead } from 'hide-common';
import { RmqService } from 'hide-rmq';
import { InviteAllDTO, InviteDTO } from 'src/common/dto/invite.dto';
import { Workspace } from 'src/common/model/workspace.entity';
import { Membership } from 'src/common/model/membership.entity';
import { roleLevels } from 'src/utils/constants';
import { InvitationPayload, JWTSignFn, JWTVerifyFn } from 'src/utils/types';
import { AcceptDTO } from 'src/common/dto/accept.dto';

@Injectable()
export class InviteService {
  constructor(
    private readonly rmq: RmqService,
    @InjectRepository(Workspace) private wsRepository: Repository<Workspace>,
    @InjectRepository(Membership) private msRepository: Repository<Membership>,
  ) {}

  async inviteUser(inviterId: string, { inviteeId, workspaceUUID }: InviteDTO, doValidate: boolean = true) {
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
    };
    const jwt = (sign as JWTSignFn<InvitationPayload>)(payload, process.env.WORKSPACE_SERVICE_SECRET!);
    const msg = createMessage<NotifyUser<WorkspaceInvite>>(inviteeId, '', {
      uid: inviteeId,
      notification: { type: 'workspace-invite', id: notificationId, inviterId, workspaceUUID, token: jwt },
    });
    this.rmq.send<ServiceMessage<NotifyUser<WorkspaceInvite>>>('notification.send', msg);
  }
  async inviteAllUsers(inviterId: string, { inviteeIds, workspaceUUID }: InviteAllDTO) {
    let err: HttpException | undefined;
    if ((err = await this.validateInvite(inviterId, workspaceUUID))) {
      throw err;
    }

    await Promise.all(
      inviteeIds.map((inviteeId) => {
        return this.inviteUser(inviterId, { inviteeId, workspaceUUID }, false);
      }),
    );
  }

  async acceptInvitation(inviteeId: string, { token }: AcceptDTO) {
    const { err, payload } = this.validateAccept(inviteeId, token);
    if (err) {
      throw err;
    }

    const workspace = await this.wsRepository.findOne({ where: { uuid: payload.workspaceUUID } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    const newMembership = new Membership();
    newMembership.setData({ workspaceId: workspace.id, userId: payload.inviteeId, role: 'member' });
    await this.msRepository.save(newMembership);

    const msg: ServiceMessage<NotificationRead> = createMessage(payload.inviteeId, '', {
      uid: payload.inviteeId,
      notificationId: payload.notificationId,
    });
    this.rmq.send<ServiceMessage<NotificationRead>>('notification.read', msg);
  }

  private async validateInvite(inviterId: string, workspaceUUID: string) {
    const workspace = await this.wsRepository.findOne({ where: { uuid: workspaceUUID } });
    if (!workspace) {
      return new BadRequestException('Workspace not found');
    }
    const membership = await this.msRepository.findOne({
      where: {
        workspaceId: workspace.id,
        userId: inviterId,
      },
    });
    if (!membership) {
      return new ForbiddenException('Not a member of the workspace');
    }
    if (roleLevels[membership.role] < 1) {
      return new ForbiddenException('Missing required priviledges for sending invitations');
    }
  }
  private validateAccept(inviteeId: string, token: string) {
    let err: HttpException | null = null;
    const payload = (verify as unknown as JWTVerifyFn<InvitationPayload>)(
      token,
      process.env.WORKSPACE_SERVICE_SECRET!,
    );
    if (!payload || inviteeId !== payload.inviteeId) {
      err = new BadRequestException('Invalid invitation token');
    }

    return { err, payload };
  }
}
