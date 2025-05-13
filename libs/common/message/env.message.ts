export type EnvPayload = {
  uuid: string;
  [k: string]: unknown;
};

export type EnvMessage = {
  action: string;
  payload: EnvPayload;
};
