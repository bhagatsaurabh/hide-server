export type JWTSignFn<T> = (payload: T, secret: string) => string;
export type JWTVerifyFn<T> = (
  payload: string,
  secret: string,
  options?: any
) => T;
export type ServicePayload = {
  sub: string;
  aud: string;
  iss: string;
  role: string;
};
