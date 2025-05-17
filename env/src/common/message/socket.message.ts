import { FSPayload } from './filesystem.message';

export type SocketMessagePayload = {
  action: string;
  [k: string]: any;
};
export type OutSocketMessageActionMap = {
  fs: FSPayload;
};
export type OutSocketMessagePayload = {
  [key: string]: unknown;
};

export type OutSocketMessage<K extends keyof OutSocketMessageActionMap> = OutSocketMessageActionMap[K];
