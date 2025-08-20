export const CACHEKEY_PRESENCE = (uid: string) => `presence:${uid}`;
export const CACHEKEY_WORKSPACE = (wsUuid: string) => `workspace:${wsUuid}`;
export const CACHEKEY_PRESENCE_SESSION = (uid: string, sessionId: string) =>
  `presence:${uid}:${sessionId}`;
export const CACHEKEY_PRESENCE_WORKSPACE = (
  uid: string,
  sessionId: string,
  wsUuid: string
) => `presence:${uid}:${sessionId}:${wsUuid}`;
// export const CACHEKEY_DOC = (docId: string) => `doc:${docId}`;

export type CachedSession = {
  state: "active" | "inactive";
  socketId: string;
  gatewayId: string;
  wsUuid?: string;
};
// uid =>
export type CachedPresence = {
  // sessionId => socketId
  [sessionId: string]: CachedSession;
};

// wsUuid =>
export type CachedWorkspace = {
  state: "active" | "inactive";

  // envInstanceId
  fs: string;
  // uids
  dirs: {
    [path: string]: string[];
  };
  // envInstanceId
  docs: {
    [docId: number]: string;
  };
  // envInstanceId
  sshs: {
    [sessionId: string]: string;
  };
};
