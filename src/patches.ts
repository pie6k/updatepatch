import { Patch } from "./types";

/**
 * Apply a list of patches to a target object, mutating it in place.
 * Supports plain objects, arrays, Maps, and Sets.
 */
export function applyPatches<T extends object>(target: T, patches: Patch[]): T {
  for (const patch of patches) {
    applyPatch(target, patch);
  }
  return target;
}

function applyPatch(root: object, patch: Patch): void {
  const { op, path, value } = patch;

  if (path.length === 0) {
    throw new Error("Cannot apply patch with empty path");
  }

  const parent = resolvePath(root, path.slice(0, -1));
  const key = path[path.length - 1];

  if (parent instanceof Map) {
    switch (op) {
      case "add":
      case "replace":
        parent.set(key, value);
        break;
      case "remove":
        parent.delete(key);
        break;
    }
    return;
  }

  if (parent instanceof Set) {
    const index = key as number;
    switch (op) {
      case "add": {
        // Insert value at the given index position
        const items = Array.from(parent);
        parent.clear();
        items.splice(index, 0, value);
        for (const item of items) parent.add(item);
        break;
      }
      case "remove": {
        const items = Array.from(parent);
        const removed = items[index];
        parent.delete(removed);
        break;
      }
    }
    return;
  }

  if (Array.isArray(parent)) {
    const numKey = typeof key === "number" ? key : Number(key);
    if (Number.isInteger(numKey) && numKey >= 0) {
      switch (op) {
        case "add":
          parent.splice(numKey, 0, value);
          break;
        case "remove":
          parent.splice(numKey, 1);
          break;
        case "replace":
          parent[numKey] = value;
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
      (parent as any)[key] = value;
      break;
    case "remove":
      delete (parent as any)[key];
      break;
  }
}

function resolvePath(root: object, segments: (string | number)[]): unknown {
  let current: any = root;
  for (const seg of segments) {
    if (current instanceof Map) {
      current = current.get(seg);
    } else if (current instanceof Set) {
      const index = typeof seg === "number" ? seg : Number(seg);
      const set: Set<unknown> = current;
      current = undefined;
      let i = 0;
      for (const item of set) {
        if (i === index) { current = item; break; }
        i++;
      }
    } else {
      current = current[seg];
    }
  }
  return current;
}
