export type CachedPresence = {
  // socketId => workspaceUuid
  sockets: Record<string, string>;
  // socketId:workspaceUuid => envInstanceId
  workspaces: Record<string, string>;
}