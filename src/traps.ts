import { Patch } from "./types";

// ---------------------------------------------------------------------------
// Accessor cache
// ---------------------------------------------------------------------------

const accessorCache = new WeakMap<object, Map<string | symbol, boolean>>();

function hasAccessor(target: object, prop: string | symbol): boolean {
  const proto = Object.getPrototypeOf(target);
  if (!proto || proto === Object.prototype) return false;

  let cache = accessorCache.get(proto);
  if (!cache) {
    cache = new Map();
    accessorCache.set(proto, cache);
  }

  const cached = cache.get(prop);
  if (cached !== undefined) return cached;

  let current: object | null = proto;
  while (current && current !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(current, prop);
    if (desc) {
      const result = !!(desc.get || desc.set);
      cache.set(prop, result);
      return result;
    }
    current = Object.getPrototypeOf(current);
  }

  cache.set(prop, false);
  return false;
}

// ---------------------------------------------------------------------------
// Proxy-based recorder
// ---------------------------------------------------------------------------

export interface RecorderContext {
  undoPatches: Patch[];
  redoPatches: Patch[];
  proxies: WeakMap<object, object>;
}

/**
 * Wrap `target` in a recording proxy.
 * Reads pass through (returning nested proxies for objects).
 * Writes mutate the real target AND record undo/redo patches.
 *
 * Each patch stores a direct reference to the mutated object (`target`)
 * and a single key (`path`), so no path arrays are allocated.
 */
export function createRecordingProxy<T extends object>(
  target: T,
  ctx: RecorderContext,
): T {
  const existing = ctx.proxies.get(target);
  if (existing) return existing as T;

  if (target instanceof Map) {
    return createMapProxy(target, ctx) as unknown as T;
  }
  if (target instanceof Set) {
    return createSetProxy(target, ctx) as unknown as T;
  }
  if (Array.isArray(target)) {
    return createArrayProxy(target, ctx) as unknown as T;
  }

  const proxy = new Proxy(target, {
    get(_target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(_target, prop, receiver);
      }

      const thisArg = hasAccessor(_target, prop) ? _target : receiver;
      const value = Reflect.get(_target, prop, thisArg);

      if (value !== null && typeof value === "object") {
        return createRecordingProxy(value as object, ctx);
      }

      return value;
    },

    set(_target, prop, newValue, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.set(_target, prop, newValue, receiver);
      }

      const thisArg = hasAccessor(_target, prop) ? _target : receiver;
      const had = Reflect.has(_target, prop);
      const oldValue = Reflect.get(_target, prop, thisArg);

      if (had && Object.is(oldValue, newValue)) return true;

      Reflect.set(_target, prop, newValue, thisArg);

      const key = String(prop);
      if (had) {
        ctx.undoPatches.push({ op: "replace", target: _target, path: key, value: oldValue });
        ctx.redoPatches.push({ op: "replace", target: _target, path: key, value: newValue });
      } else {
        ctx.undoPatches.push({ op: "remove", target: _target, path: key });
        ctx.redoPatches.push({ op: "add", target: _target, path: key, value: newValue });
      }

      return true;
    },

    deleteProperty(_target, prop) {
      if (typeof prop === "symbol") {
        return Reflect.deleteProperty(_target, prop);
      }

      const key = String(prop);
      const oldValue = (_target as any)[prop];

      Reflect.deleteProperty(_target, prop);

      ctx.undoPatches.push({ op: "add", target: _target, path: key, value: oldValue });
      ctx.redoPatches.push({ op: "remove", target: _target, path: key });

      return true;
    },
  });

  ctx.proxies.set(target, proxy);
  return proxy;
}

// ---------------------------------------------------------------------------
// Array proxy
// ---------------------------------------------------------------------------

function createArrayProxy<T>(
  target: T[],
  ctx: RecorderContext,
): T[] {
  let suppressTraps = false;
  let proxy: T[];

  const methods: Record<string, Function> = {
    push(...items: T[]) {
      const startIndex = target.length;
      suppressTraps = true;
      const result = target.push(...items);
      suppressTraps = false;

      for (let i = 0; i < items.length; i++) {
        ctx.undoPatches.push({ op: "remove", target, path: startIndex + i });
        ctx.redoPatches.push({ op: "add", target, path: startIndex + i, value: items[i] });
      }
      return result;
    },

    pop() {
      if (target.length === 0) return undefined;
      const index = target.length - 1;
      const removed = target[index];
      suppressTraps = true;
      target.pop();
      suppressTraps = false;

      ctx.undoPatches.push({ op: "add", target, path: index, value: removed });
      ctx.redoPatches.push({ op: "remove", target, path: index });
      return removed;
    },

    shift() {
      if (target.length === 0) return undefined;
      const removed = target[0];
      suppressTraps = true;
      target.shift();
      suppressTraps = false;

      ctx.undoPatches.push({ op: "add", target, path: 0, value: removed });
      ctx.redoPatches.push({ op: "remove", target, path: 0 });
      return removed;
    },

    unshift(...items: T[]) {
      suppressTraps = true;
      const result = target.unshift(...items);
      suppressTraps = false;

      for (let i = 0; i < items.length; i++) {
        ctx.undoPatches.push({ op: "remove", target, path: 0 });
        ctx.redoPatches.push({ op: "add", target, path: i, value: items[i] });
      }
      return result;
    },

    splice(start: number, deleteCount?: number, ...items: T[]) {
      const len = target.length;
      const actualStart =
        start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
      const actualDeleteCount =
        deleteCount === undefined
          ? len - actualStart
          : Math.min(Math.max(deleteCount, 0), len - actualStart);

      const removedRefs = target.slice(
        actualStart,
        actualStart + actualDeleteCount,
      );

      suppressTraps = true;
      const removed = target.splice(actualStart, actualDeleteCount, ...items);
      suppressTraps = false;

      // Undo: after global reversal → remove inserted back-to-front,
      // then re-add removed front-to-back.
      for (let i = removedRefs.length - 1; i >= 0; i--) {
        ctx.undoPatches.push({
          op: "add", target, path: actualStart + i, value: removedRefs[i],
        });
      }
      for (let i = 0; i < items.length; i++) {
        ctx.undoPatches.push({
          op: "remove", target, path: actualStart + i,
        });
      }

      // Redo: remove old back-to-front, add new front-to-back
      for (let i = actualDeleteCount - 1; i >= 0; i--) {
        ctx.redoPatches.push({
          op: "remove", target, path: actualStart + i,
        });
      }
      for (let i = 0; i < items.length; i++) {
        ctx.redoPatches.push({
          op: "add", target, path: actualStart + i, value: items[i],
        });
      }

      return removed;
    },

    sort(...args: any[]) {
      const before = [...target];
      suppressTraps = true;
      target.sort(...args);
      suppressTraps = false;

      for (let i = 0; i < target.length; i++) {
        if (before[i] !== target[i]) {
          ctx.undoPatches.push({ op: "replace", target, path: i, value: before[i] });
          ctx.redoPatches.push({ op: "replace", target, path: i, value: target[i] });
        }
      }
      return proxy;
    },

    reverse() {
      const before = [...target];
      suppressTraps = true;
      target.reverse();
      suppressTraps = false;

      for (let i = 0; i < target.length; i++) {
        if (before[i] !== target[i]) {
          ctx.undoPatches.push({ op: "replace", target, path: i, value: before[i] });
          ctx.redoPatches.push({ op: "replace", target, path: i, value: target[i] });
        }
      }
      return proxy;
    },
  };

  const boundMethods = new Map<string, Function>();

  proxy = new Proxy(target, {
    get(_target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(_target, prop, receiver);
      }

      if (prop in methods) return methods[prop];

      const value = Reflect.get(_target, prop, receiver);

      if (typeof value === "function") {
        const cached = boundMethods.get(prop);
        if (cached) return cached;
        const bound = value.bind(proxy);
        boundMethods.set(prop, bound);
        return bound;
      }

      if (value !== null && typeof value === "object") {
        return createRecordingProxy(value as object, ctx);
      }

      return value;
    },

    set(_target, prop, newValue, receiver) {
      if (suppressTraps || typeof prop === "symbol") {
        return Reflect.set(_target, prop, newValue, receiver);
      }

      if (prop === "length") {
        const oldLength = _target.length;
        const newLength = Number(newValue);
        if (newLength < oldLength) {
          for (let i = oldLength - 1; i >= newLength; i--) {
            if (i in _target) {
              ctx.undoPatches.push({ op: "add", target: _target, path: i, value: _target[i] });
              ctx.redoPatches.push({ op: "remove", target: _target, path: i });
            }
          }
        }
        Reflect.set(_target, prop, newValue);
        return true;
      }

      const segment = toPathSegment(_target, prop);
      const had = Reflect.has(_target, prop);
      const oldValue = Reflect.get(_target, prop, receiver);

      if (had && Object.is(oldValue, newValue)) return true;

      Reflect.set(_target, prop, newValue, receiver);

      if (had) {
        ctx.undoPatches.push({ op: "replace", target: _target, path: segment, value: oldValue });
        ctx.redoPatches.push({ op: "replace", target: _target, path: segment, value: newValue });
      } else {
        ctx.undoPatches.push({ op: "remove", target: _target, path: segment });
        ctx.redoPatches.push({ op: "add", target: _target, path: segment, value: newValue });
      }

      return true;
    },

    deleteProperty(_target, prop) {
      if (suppressTraps || typeof prop === "symbol") {
        return Reflect.deleteProperty(_target, prop);
      }

      const segment = toPathSegment(_target, prop);
      const oldValue = (_target as any)[prop];

      Reflect.deleteProperty(_target, prop);

      ctx.undoPatches.push({ op: "add", target: _target, path: segment, value: oldValue });
      ctx.redoPatches.push({ op: "remove", target: _target, path: segment });

      return true;
    },
  });

  ctx.proxies.set(target, proxy);
  return proxy;
}

// ---------------------------------------------------------------------------
// Helpers for wrapping iteration values in recording proxies
// ---------------------------------------------------------------------------

function proxyValue<V>(
  value: V,
  ctx: RecorderContext,
): V {
  if (value !== null && typeof value === "object") {
    return createRecordingProxy(value as object, ctx) as unknown as V;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Map proxy
// ---------------------------------------------------------------------------

function createMapProxy<K, V>(
  target: Map<K, V>,
  ctx: RecorderContext,
): Map<K, V> {
  const getMethod = (k: K) => {
    return proxyValue(target.get(k) as V, ctx);
  };

  const setMethod = (key: K, value: V): Map<K, V> => {
    const had = target.has(key);
    const oldValue = target.get(key);

    if (had && Object.is(oldValue, value)) return mapProxy;

    target.set(key, value);

    const p = String(key);
    if (had) {
      ctx.undoPatches.push({ op: "replace", target, path: p, value: oldValue });
      ctx.redoPatches.push({ op: "replace", target, path: p, value: value });
    } else {
      ctx.undoPatches.push({ op: "remove", target, path: p });
      ctx.redoPatches.push({ op: "add", target, path: p, value: value });
    }

    return mapProxy;
  };

  const deleteMethod = (key: K): boolean => {
    if (!target.has(key)) return false;

    const p = String(key);
    const oldValue = target.get(key);

    target.delete(key);

    ctx.undoPatches.push({ op: "add", target, path: p, value: oldValue });
    ctx.redoPatches.push({ op: "remove", target, path: p });

    return true;
  };

  const clearMethod = (): void => {
    const entries = Array.from(target.entries());
    target.clear();

    for (const [key, value] of entries) {
      const p = String(key);
      ctx.undoPatches.push({ op: "add", target, path: p, value: value });
      ctx.redoPatches.push({ op: "remove", target, path: p });
    }
  };

  const forEachMethod = (
    cb: (value: V, key: K, map: Map<K, V>) => void,
  ) => {
    target.forEach((value, key) => {
      cb(proxyValue(value, ctx), key, mapProxy);
    });
  };

  function* proxiedValues(): IterableIterator<V> {
    for (const [_key, value] of target) {
      yield proxyValue(value, ctx);
    }
  }

  function* proxiedEntries(): IterableIterator<[K, V]> {
    for (const [key, value] of target) {
      yield [key, proxyValue(value, ctx)];
    }
  }

  const hasMethod = target.has.bind(target);
  const keysMethod = target.keys.bind(target);

  const mapProxy = new Proxy(target, {
    get(_target, prop) {
      if (prop === "size") return target.size;
      if (prop === Symbol.toStringTag) return "Map";
      if (prop === Symbol.iterator) return () => proxiedEntries();

      switch (prop) {
        case "get":      return getMethod;
        case "set":      return setMethod;
        case "delete":   return deleteMethod;
        case "clear":    return clearMethod;
        case "has":      return hasMethod;
        case "forEach":  return forEachMethod;
        case "keys":     return keysMethod;
        case "values":   return () => proxiedValues();
        case "entries":  return () => proxiedEntries();
      }

      return Reflect.get(_target, prop);
    },
  }) as Map<K, V>;

  ctx.proxies.set(target, mapProxy);
  return mapProxy;
}

// ---------------------------------------------------------------------------
// Set proxy
// ---------------------------------------------------------------------------

function setIndexOf<V>(set: Set<V>, value: V): number {
  let i = 0;
  for (const item of set) {
    if (item === value) return i;
    i++;
  }
  return -1;
}

function createSetProxy<V>(
  target: Set<V>,
  ctx: RecorderContext,
): Set<V> {
  const addMethod = (value: V): Set<V> => {
    if (target.has(value)) return setProxy;

    const index = target.size;
    target.add(value);

    ctx.undoPatches.push({ op: "remove", target, path: index });
    ctx.redoPatches.push({ op: "add", target, path: index, value: value });

    return setProxy;
  };

  const deleteMethod = (value: V): boolean => {
    if (!target.has(value)) return false;

    const index = setIndexOf(target, value);
    target.delete(value);

    ctx.undoPatches.push({ op: "add", target, path: index, value: value });
    ctx.redoPatches.push({ op: "remove", target, path: index });

    return true;
  };

  const clearMethod = (): void => {
    const items = Array.from(target);
    target.clear();

    for (let i = items.length - 1; i >= 0; i--) {
      ctx.undoPatches.push({ op: "add", target, path: i, value: items[i] });
      ctx.redoPatches.push({ op: "remove", target, path: i });
    }
  };

  function* proxiedValues(): IterableIterator<V> {
    for (const value of target) {
      yield proxyValue(value, ctx);
    }
  }

  function* proxiedEntries(): IterableIterator<[V, V]> {
    for (const value of target) {
      const p = proxyValue(value, ctx);
      yield [p, p];
    }
  }

  const forEachMethod = (
    cb: (value: V, value2: V, set: Set<V>) => void,
  ) => {
    target.forEach((value) => {
      const p = proxyValue(value, ctx);
      cb(p, p, setProxy);
    });
  };

  const hasMethod = target.has.bind(target);

  const setProxy = new Proxy(target, {
    get(_target, prop) {
      if (prop === "size") return target.size;
      if (prop === Symbol.toStringTag) return "Set";
      if (prop === Symbol.iterator) return () => proxiedValues();

      switch (prop) {
        case "add":      return addMethod;
        case "delete":   return deleteMethod;
        case "clear":    return clearMethod;
        case "has":      return hasMethod;
        case "forEach":  return forEachMethod;
        case "keys":     return () => proxiedValues();
        case "values":   return () => proxiedValues();
        case "entries":  return () => proxiedEntries();
      }

      return Reflect.get(_target, prop);
    },
  }) as Set<V>;

  ctx.proxies.set(target, setProxy);
  return setProxy;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toPathSegment(target: object, prop: string | symbol): string | number {
  if (Array.isArray(target) && !isNaN(Number(prop))) {
    return Number(prop);
  }
  return String(prop);
}
