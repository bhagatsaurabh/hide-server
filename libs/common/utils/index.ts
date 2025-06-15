import { createHash } from "node:crypto";

export const debounce = <C extends (...args: any[]) => any>(
  func: C,
  wait: number
) => {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<C>): void => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => void func(...args), wait);
  };
};

export const getHashedKey = (...parts: string[]) => {
  return createHash("sha256").update(parts.join(":")).digest("hex");
};

export const isRpcPayloadError = (err: unknown): err is RpcError => {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    "statusCode" in err
  );
};

export class RpcError extends Error {
  constructor(public statusCode: number, public message: string) {
    super(message);
  }
}
