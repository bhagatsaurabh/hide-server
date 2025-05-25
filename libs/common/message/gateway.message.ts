export interface UserSocketClose {
  socketId: string;
}

export type GatewayResponseMap = {
  "socket.close": UserSocketClose;
};
export type GatewayPayload = {
  [K in keyof GatewayResponseMap]: {
    action: K;
    payload: GatewayResponseMap[K];
  };
}[keyof GatewayResponseMap];
