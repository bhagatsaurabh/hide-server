export type WebHookType = "user.registered";

export type WebHookDTO<T> = {
  type: WebHookType;
  payload: T;
};

export type UserRegistered = {
  uid: string;
  username: string;
};
