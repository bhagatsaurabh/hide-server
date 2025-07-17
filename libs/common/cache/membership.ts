export const CACHEKEY_MEMBERSHIP = (uid: string) => `membership:${uid}`;

export type CachedMembership = {
  [wsUuid: string]: boolean;
};
