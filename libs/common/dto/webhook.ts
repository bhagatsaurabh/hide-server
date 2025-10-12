import { User } from "model/user";

export type WebHookType = "user.registered" | "user.deleted";

export type WebHookDTO<T> = {
  type: WebHookType;
  payload: T;
};

export type UserRegistered = User;
export type UserDeleted = UserRegistered;
