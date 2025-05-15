import { Injectable } from '@nestjs/common';
import { Cache } from '@nestjs/cache-manager';
import { User } from 'hide-common/dto/user';
import { RedisService } from 'hide-redis';
import { MembersModified, WorkspaceDeleted } from 'hide-common';

export type CachedMembership = Record<string, boolean>;

@Injectable()
export class CommonService {
  private cache: Cache;

  constructor(private readonly redisService: RedisService) {
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
    try {
      const response = await fetch(`http://workspace/api/${workspaceUUID}/check-membership`, {
        method: 'GET',
        headers: {
          'x-auth-user': Buffer.from(JSON.stringify(user)).toString('base64'),
        },
      });
      let isMember = false;
      if (response.ok) {
        isMember = true;
      }
      await this.cacheMembership(user.uid, workspaceUUID, isMember, cache);
      return isMember;
    } catch (error) {
      console.log(error);
    }
    return false;
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
