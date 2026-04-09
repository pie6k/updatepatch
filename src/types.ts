export interface Patch {
  op: "replace" | "remove" | "add";
  path: (string | number)[];
  value?: any;
}

export type Recipe<T> = (draft: T) => void;
