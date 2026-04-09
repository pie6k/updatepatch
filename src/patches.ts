import { Patch } from "./types";

/**
 * Apply a list of patches, mutating each patch's target in place.
 * Returns `root` for chaining.
 */
export function applyPatches<T extends object>(root: T, patches: Patch[]): T {
  for (const patch of patches) {
    applyPatch(patch);
  }
  return root;
}

function applyPatch(patch: Patch): void {
  const { op, target, path, value } = patch;

  if (target instanceof Map) {
    switch (op) {
      case "add":
      case "replace":
        target.set(path, value);
        break;
      case "remove":
        target.delete(path);
        break;
    }
    return;
  }

  if (target instanceof Set) {
    const index = path as number;
    switch (op) {
      case "add": {
        const items = Array.from(target);
        target.clear();
        items.splice(index, 0, value);
        for (const item of items) target.add(item);
        break;
      }
      case "remove": {
        const items = Array.from(target);
        const removed = items[index];
        target.delete(removed);
        break;
      }
    }
    return;
  }

  if (Array.isArray(target)) {
    const numKey = typeof path === "number" ? path : Number(path);
    if (Number.isInteger(numKey) && numKey >= 0) {
      switch (op) {
        case "add":
          target.splice(numKey, 0, value);
          break;
        case "remove":
          target.splice(numKey, 1);
          break;
        case "replace":
          target[numKey] = value;
          break;
      }
      return;
    }
    // Fall through to object handling for non-index keys (e.g. "length")
  }

  // Plain object (or class instance)
  switch (op) {
    case "add":
    case "replace":
      (target as any)[path] = value;
      break;
    case "remove":
      delete (target as any)[path];
      break;
  }
}
