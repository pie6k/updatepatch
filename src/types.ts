export interface Patch {
  op: "replace" | "remove" | "add";
  target: object;
  path: string | number;
  value?: any;
}

export type Recipe<T> = (draft: T) => void;
