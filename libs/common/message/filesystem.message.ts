export type File = {
  name: string;
  path: string;
  type: "file" | "dir";
};

export type FSSync = {
  uid: string;
  path: string;
  action: "add" | "addDir" | "unlink" | "unlinkDir" | "change";
};
