export type OneOrMore<T> = T | Array<T>;
export const isObjEmpty = (obj: object) => Object.keys(obj).length === 0;
