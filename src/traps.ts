import { Patch } from "./types";

// ---------------------------------------------------------------------------
// Accessor cache
// ---------------------------------------------------------------------------

/**
 * Cache for prototype-chain accessor lookups, keyed by prototype.
 * All instances of the same class share the prototype, so a single
 * lookup per (prototype, prop) pair is enough.
 */
const accessorCache = new WeakMap<object, Map<string | symbol, boolean>>();

/**
 * Check if `prop` is backed by a getter/setter on the prototype chain
 * (e.g. the `accessor` keyword, which compiles to a WeakMap-backed private
 * field). When true, `Reflect.get/set` must receive the real target as
 * `this` — not the proxy — or the private-field access will throw.
 *
 * Results are cached per prototype so the chain is walked at most once
 * per (class, property) pair.
 */
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
 * Wrap `target` in a recording proxy rooted at `basePath`.
 * Reads pass through (returning nested proxies for objects).
 * Writes mutate the real target AND record undo/redo patches.
 *
 * Patch values always store original references — never copies.
 */
export function createRecordingProxy<T extends object>(
  target: T,
  basePath: (string | number)[],
  ctx: RecorderContext,
): T {
  const existing = ctx.proxies.get(target);
  if (existing) return existing as T;

  if (target instanceof Map) {
    return createMapProxy(target, basePath, ctx) as unknown as T;
  }
  if (target instanceof Set) {
    return createSetProxy(target, basePath, ctx) as unknown as T;
  }
  if (Array.isArray(target)) {
    return createArrayProxy(target, basePath, ctx) as unknown as T;
  }

  const proxy = new Proxy(target, {
    get(_target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(_target, prop, receiver);
      }

      // Accessor properties (e.g. `accessor` keyword) use private fields
      // that only exist on the real target, not on the proxy.
      const thisArg = hasAccessor(_target, prop) ? _target : receiver;
      const value = Reflect.get(_target, prop, thisArg);

      if (value !== null && typeof value === "object") {
        const childPath = [...basePath, String(prop)];
        return createRecordingProxy(value as object, childPath, ctx);
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

      const path = [...basePath, String(prop)];
      if (had) {
        ctx.undoPatches.push({ op: "replace", path, value: oldValue });
        ctx.redoPatches.push({ op: "replace", path, value: newValue });
      } else {
        ctx.undoPatches.push({ op: "remove", path });
        ctx.redoPatches.push({ op: "add", path, value: newValue });
      }

      return true;
    },

    deleteProperty(_target, prop) {
      if (typeof prop === "symbol") {
        return Reflect.deleteProperty(_target, prop);
      }

      const path = [...basePath, String(prop)];
      const oldValue = (_target as any)[prop];

      Reflect.deleteProperty(_target, prop);

      ctx.undoPatches.push({ op: "add", path, value: oldValue });
      ctx.redoPatches.push({ op: "remove", path });

      return true;
    },
  });

  ctx.proxies.set(target, proxy);
  return proxy;
}

// ---------------------------------------------------------------------------
// Array proxy — intercepts mutating methods to generate clean patches
// ---------------------------------------------------------------------------

function createArrayProxy<T>(
  target: T[],
  basePath: (string | number)[],
  ctx: RecorderContext,
): T[] {
  // When true, set/deleteProperty traps pass through without recording.
  // Used while an intercepted method is running its internal operations.
  let suppressTraps = false;

  // Pre-created method interceptors — avoids allocating closures on
  // every property access.  `proxy` is assigned after construction
  // but always before any method can be called.
  let proxy: T[];

  const methods: Record<string, Function> = {
    push(...items: T[]) {
      const startIndex = target.length;
      suppressTraps = true;
      const result = target.push(...items);
      suppressTraps = false;

      for (let i = 0; i < items.length; i++) {
        const path = [...basePath, startIndex + i];
        ctx.undoPatches.push({ op: "remove", path });
        ctx.redoPatches.push({ op: "add", path, value: items[i] });
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

      const path = [...basePath, index];
      ctx.undoPatches.push({ op: "add", path, value: removed });
      ctx.redoPatches.push({ op: "remove", path });
      return removed;
    },

    shift() {
      if (target.length === 0) return undefined;
      const removed = target[0];
      suppressTraps = true;
      target.shift();
      suppressTraps = false;

      const path = [...basePath, 0];
      ctx.undoPatches.push({ op: "add", path, value: removed });
      ctx.redoPatches.push({ op: "remove", path });
      return removed;
    },

    unshift(...items: T[]) {
      suppressTraps = true;
      const result = target.unshift(...items);
      suppressTraps = false;

      for (let i = 0; i < items.length; i++) {
        ctx.undoPatches.push({ op: "remove", path: [...basePath, 0] });
        ctx.redoPatches.push({
          op: "add",
          path: [...basePath, i],
          value: items[i],
        });
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

      // Undo: recorded so that after global reversal the application
      // order is: remove inserted items back-to-front, then re-add
      // removed items front-to-back.
      for (let i = removedRefs.length - 1; i >= 0; i--) {
        ctx.undoPatches.push({
          op: "add",
          path: [...basePath, actualStart + i],
          value: removedRefs[i],
        });
      }
      for (let i = 0; i < items.length; i++) {
        ctx.undoPatches.push({
          op: "remove",
          path: [...basePath, actualStart + i],
        });
      }

      // Redo: remove old back-to-front, add new front-to-back
      for (let i = actualDeleteCount - 1; i >= 0; i--) {
        ctx.redoPatches.push({
          op: "remove",
          path: [...basePath, actualStart + i],
        });
      }
      for (let i = 0; i < items.length; i++) {
        ctx.redoPatches.push({
          op: "add",
          path: [...basePath, actualStart + i],
          value: items[i],
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
          const path = [...basePath, i];
          ctx.undoPatches.push({ op: "replace", path, value: before[i] });
          ctx.redoPatches.push({ op: "replace", path, value: target[i] });
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
          const path = [...basePath, i];
          ctx.undoPatches.push({ op: "replace", path, value: before[i] });
          ctx.redoPatches.push({ op: "replace", path, value: target[i] });
        }
      }
      return proxy;
    },
  };

  // Cache for bound non-mutating methods (filter, map, indexOf, …)
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
        const childPath = [...basePath, toPathSegment(_target, prop)];
        return createRecordingProxy(value as object, childPath, ctx);
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
              const path = [...basePath, i];
              ctx.undoPatches.push({ op: "add", path, value: _target[i] });
              ctx.redoPatches.push({ op: "remove", path });
            }
          }
        }
        Reflect.set(_target, prop, newValue);
        return true;
      }

      const had = Reflect.has(_target, prop);
      const oldValue = Reflect.get(_target, prop, receiver);

      if (had && Object.is(oldValue, newValue)) return true;

      Reflect.set(_target, prop, newValue, receiver);

      const segment = toPathSegment(_target, prop);
      const path = [...basePath, segment];
      if (had) {
        ctx.undoPatches.push({ op: "replace", path, value: oldValue });
        ctx.redoPatches.push({ op: "replace", path, value: newValue });
      } else {
        ctx.undoPatches.push({ op: "remove", path });
        ctx.redoPatches.push({ op: "add", path, value: newValue });
      }

      return true;
    },

    deleteProperty(_target, prop) {
      if (suppressTraps || typeof prop === "symbol") {
        return Reflect.deleteProperty(_target, prop);
      }

      const segment = toPathSegment(_target, prop);
      const path = [...basePath, segment];
      const oldValue = (_target as any)[prop];

      Reflect.deleteProperty(_target, prop);

      ctx.undoPatches.push({ op: "add", path, value: oldValue });
      ctx.redoPatches.push({ op: "remove", path });

      return true;
    },
  });

  ctx.proxies.set(target, proxy);
  return proxy;
}

// ---------------------------------------------------------------------------
// Helpers for wrapping iteration values in recording proxies
// ---------------------------------------------------------------------------

/** If `value` is an object, wrap it in a recording proxy at `path`. */
function proxyValue<V>(
  value: V,
  path: (string | number)[],
  ctx: RecorderContext,
): V {
  if (value !== null && typeof value === "object") {
    return createRecordingProxy(value as object, path, ctx) as unknown as V;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Map proxy
// ---------------------------------------------------------------------------

function createMapProxy<K, V>(
  target: Map<K, V>,
  basePath: (string | number)[],
  ctx: RecorderContext,
): Map<K, V> {
  /** Derive the child path for a given map key. */
  const childPath = (key: K) => [...basePath, String(key)];

  // ----- Mutating interceptors -----

  const getMethod = (k: K) => {
    return proxyValue(target.get(k) as V, childPath(k), ctx);
  };

  const setMethod = (key: K, value: V): Map<K, V> => {
    const had = target.has(key);
    const oldValue = target.get(key);

    if (had && Object.is(oldValue, value)) return mapProxy;

    target.set(key, value);

    const path = childPath(key);
    if (had) {
      ctx.undoPatches.push({ op: "replace", path, value: oldValue });
      ctx.redoPatches.push({ op: "replace", path, value: value });
    } else {
      ctx.undoPatches.push({ op: "remove", path });
      ctx.redoPatches.push({ op: "add", path, value: value });
    }

    return mapProxy;
  };

  const deleteMethod = (key: K): boolean => {
    if (!target.has(key)) return false;

    const path = childPath(key);
    const oldValue = target.get(key);

    target.delete(key);

    ctx.undoPatches.push({ op: "add", path, value: oldValue });
    ctx.redoPatches.push({ op: "remove", path });

    return true;
  };

  const clearMethod = (): void => {
    const entries = Array.from(target.entries());
    target.clear();

    for (const [key, value] of entries) {
      const path = childPath(key);
      ctx.undoPatches.push({ op: "add", path, value: value });
      ctx.redoPatches.push({ op: "remove", path });
    }
  };

  // ----- Iteration — yields proxied values so nested mutations are tracked -----

  const forEachMethod = (
    cb: (value: V, key: K, map: Map<K, V>) => void,
  ) => {
    target.forEach((value, key) => {
      cb(proxyValue(value, childPath(key), ctx), key, mapProxy);
    });
  };

  function* proxiedValues(): IterableIterator<V> {
    for (const [key, value] of target) {
      yield proxyValue(value, childPath(key), ctx);
    }
  }

  function* proxiedEntries(): IterableIterator<[K, V]> {
    for (const [key, value] of target) {
      yield [key, proxyValue(value, childPath(key), ctx)];
    }
  }

  const hasMethod = target.has.bind(target);
  const keysMethod = target.keys.bind(target);

  const mapProxy = new Proxy(target, {
    get(_target, prop) {
      if (prop === "size") return target.size;
      if (prop === Symbol.toStringTag) return "Map";

      // Iterator / entries return proxied values
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

/** Find the iteration index of `value` in `set` without allocating an array. */
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
  basePath: (string | number)[],
  ctx: RecorderContext,
): Set<V> {
  // ----- Mutating interceptors -----

  const addMethod = (value: V): Set<V> => {
    if (target.has(value)) return setProxy;

    const path = [...basePath, target.size];
    target.add(value);

    ctx.undoPatches.push({ op: "remove", path });
    ctx.redoPatches.push({ op: "add", path, value: value });

    return setProxy;
  };

  const deleteMethod = (value: V): boolean => {
    if (!target.has(value)) return false;

    const index = setIndexOf(target, value);
    const path = [...basePath, index];

    target.delete(value);

    ctx.undoPatches.push({ op: "add", path, value: value });
    ctx.redoPatches.push({ op: "remove", path });

    return true;
  };

  const clearMethod = (): void => {
    const items = Array.from(target);
    target.clear();

    // Record in reverse so global reversal yields front-to-back restore
    for (let i = items.length - 1; i >= 0; i--) {
      const path = [...basePath, i];
      ctx.undoPatches.push({ op: "add", path, value: items[i] });
      ctx.redoPatches.push({ op: "remove", path });
    }
  };

  // ----- Iteration — yields proxied values so nested mutations are tracked -----

  function* proxiedValues(): IterableIterator<V> {
    let i = 0;
    for (const value of target) {
      yield proxyValue(value, [...basePath, i], ctx);
      i++;
    }
  }

  function* proxiedEntries(): IterableIterator<[V, V]> {
    let i = 0;
    for (const value of target) {
      const p = proxyValue(value, [...basePath, i], ctx);
      yield [p, p];
      i++;
    }
  }

  const forEachMethod = (
    cb: (value: V, value2: V, set: Set<V>) => void,
  ) => {
    let i = 0;
    target.forEach((value) => {
      const p = proxyValue(value, [...basePath, i], ctx);
      cb(p, p, setProxy);
      i++;
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
