import { Injectable } from '@nestjs/common';
import { Cache } from '@nestjs/cache-manager';
import { User } from 'hide-common/dto/user';
import { RedisService } from 'hide-redis';
import { MembershipCheck, MembersModified, ServiceMessage, WorkspaceDeleted } from 'hide-common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

export type CachedMembership = Record<string, boolean>;

@Injectable()
export class CommonService {
  private cache: Cache;

  constructor(
    private readonly redisService: RedisService,
    private readonly rmq: ClientProxy,
  ) {
    this.cache = this.redisService.get();
  }

  async checkMembership(user: User, workspaceUUID: string) {
    const cachedMemberships = await this.cache.get<CachedMembership>(`membership:${user.uid}`);
    if (cachedMemberships && cachedMemberships[workspaceUUID] !== undefined) {
      return cachedMemberships[workspaceUUID];
    }

    return await this.fetchMembership(user, workspaceUUID, cachedMemberships);
  }
  async fetchMembership(user: User, workspaceUUID: string, cache: CachedMembership | null) {
    const observable = this.rmq.send<boolean, ServiceMessage<MembershipCheck>>('workspace.membership.check', {
      payload: { uid: user.uid, uuid: workspaceUUID },
    });
    const isMember = await firstValueFrom(observable);

    await this.cacheMembership(user.uid, workspaceUUID, isMember, cache);
    return isMember;
  }
  async cacheMembership(
    uid: string,
    workspaceUUID: string,
    isMember: boolean,
    cache: CachedMembership | null,
  ) {
    if (!cache) {
      cache = {};
    }
    cache[workspaceUUID] = isMember;
    await this.cache.set(`membership:${uid}`, cache);
  }

  async handleMembersModified(msg: MembersModified) {
    await this.invalidateRemovedMembers(msg.removed, msg.uuid);
    await this.updateAddedMembers(msg.added, msg.uuid);
  }
  async invalidateRemovedMembers(uids: string[], uuid: string) {
    const removed = new Map<string, CachedMembership | null>();
    const cachedMemberships = await Promise.all(uids.map((uid) => this.cache.get<CachedMembership>(uid)));
    uids.forEach((uid, idx) => removed.set(uid, cachedMemberships[idx]));

    for (const [uid, cache] of removed.entries()) {
      let modified = false;
      if (!cache) {
        continue;
      }
      if (cache[uuid] !== undefined) {
        delete cache[uuid];
        modified = true;
      }
      if (modified) {
        await this.cache.set(uid, cache);
      }
    }
  }
  async updateAddedMembers(uids: string[], uuid: string) {
    const added = new Map<string, CachedMembership | null>();
    const cachedMemberships = await Promise.all(uids.map((uid) => this.cache.get<CachedMembership>(uid)));
    uids.forEach((uid, idx) => added.set(uid, cachedMemberships[idx]));

    for (const [uid, cache] of added.entries()) {
      let modified = false;
      if (!cache) {
        continue;
      }
      if (cache[uuid] !== undefined) {
        cache[uuid] = true;
        modified = true;
      }
      if (modified) {
        await this.cache.set(uid, cache);
      }
    }
  }
  async handleWorkspaceDeleted({ uuid, members }: WorkspaceDeleted) {
    await this.invalidateRemovedMembers(members, uuid);
  }
}
