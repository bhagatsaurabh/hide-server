export const debounce = <C extends (...args: any[]) => any>(func: C, wait: number) => {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<C>): void => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => void func(...args), wait);
  };
};
