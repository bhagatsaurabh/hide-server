export type WebHookType = "user.registered" | "user.deleted";

export type WebHookDTO<T> = {
  type: WebHookType;
  payload: T;
};

export type UserRegistered = {
  uid: string;
  username: string;
  name: string;
};

export type UserDeleted = UserRegistered;
