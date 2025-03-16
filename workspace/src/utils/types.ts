export type JWTSignFn<T> = (payload: T, secret: string) => string;
export type JWTVerifyFn<T> = (payload: string, secret: string, options?: any) => T;
export type InvitationPayload = {
  inviterId: string;
  inviteeId: string;
  workspaceUUID: string;
  validTill: number;
};
