const levels = ["error", "warn", "info", "debug"];
const currentLevel = process.env.LOG_LEVEL || "info";

const shouldLog = (level: string) => {
  return levels.indexOf(level) <= levels.indexOf(currentLevel);
};

export const logger = {
  error: (...args: any[]) => shouldLog("error") && console.error(...args),
  warn: (...args: any[]) => shouldLog("warn") && console.warn(...args),
  info: (...args: any[]) => shouldLog("info") && console.info(...args),
  debug: (...args: any[]) => shouldLog("debug") && console.debug(...args),
};
