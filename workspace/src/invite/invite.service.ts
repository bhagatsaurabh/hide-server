import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { sign, verify } from 'jsonwebtoken';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  InvitationData,
  NotificationMessage,
  NotificationType,
} from 'hide-common/message/notification.message';
import { InviteDTO } from 'src/common/dto/invite.dto';
import { Workspace } from 'src/common/model/workspace.entity';
import { Membership } from 'src/common/model/membership.entity';
import { roleLevels } from 'src/utils/constants';
import { InvitationPayload, JWTSignFn, JWTVerifyFn } from 'src/utils/types';
import { AcceptDTO } from 'src/common/dto/accept.dto';

@Injectable()
export class InviteService {
  constructor(
    @Inject('WORKSPACE_SERVICE') private client: ClientProxy,
    @InjectRepository(Workspace) private wsRepository: Repository<Workspace>,
    @InjectRepository(Membership) private msRepository: Repository<Membership>,
  ) {}

  async inviteUser(inviterId: string, { inviteeId, workspaceUUID }: InviteDTO) {
    let err: HttpException | undefined;
    if ((err = await this.validateInvite(inviterId, workspaceUUID))) {
      throw err;
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);

    const payload = {
      inviterId,
      inviteeId,
      workspaceUUID,
      validTill: expiryDate.getTime(),
    };
    const jwt = (sign as JWTSignFn<InvitationPayload>)(payload, process.env.WORKSPACE_SERVICE_SECRET!);
    this.client.emit<any, NotificationMessage<InvitationData>>('notify', {
      uid: inviteeId,
      type: NotificationType.WORKSPACE_INVITE,
      data: { inviterId, workspaceUUID, token: jwt },
    });
  }

  async acceptInvitation(inviteeId: string, { token }: AcceptDTO) {
    const { err, payload } = this.validateAccept(token);
    if (err) {
      throw err;
    }

    const workspace = await this.wsRepository.findOne({ where: { uuid: payload.workspaceUUID } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    const newMembership = new Membership({
      workspaceId: workspace.id,
      userId: inviteeId,
      role: 'member',
    });
    await this.msRepository.save(newMembership);
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
  private validateAccept(token: string) {
    let err: HttpException | null = null;
    const payload = (verify as unknown as JWTVerifyFn<InvitationPayload>)(
      token,
      process.env.WORKSPACE_SERVICE_SECRET!,
    );
    if (!payload) {
      err = new BadRequestException('Invalid invitation token');
    }

    return { err, payload };
  }
}
