# updatepatch

Undo/redo for any mutable state. Works with plain objects, classes, arrays, Maps, and Sets — no immutability required.

## Quick start

Call `updateWithUndo` with any object and a callback. Inside the callback, `draft` behaves exactly like the original object — you can read properties, call methods, iterate, do conditional logic, anything you'd normally do. The only difference is that every mutation is silently recorded so it can later produce undo/redo patches.

```ts
import { updateWithUndo, applyPatches } from "updatepatch";

const state = { name: "Alice", tags: ["admin"], score: 5 };

const [undo, redo] = updateWithUndo(state, (draft) => {
  if (draft.score > 3) {
    draft.name = "Bob";
    draft.tags.push("editor");
  }
});
```

After the callback runs, `state` is mutated:

```ts
state.name; // "Bob"
state.tags; // ["admin", "editor"]
```

The returned `undo` and `redo` are arrays of patches. Apply `undo` to reverse everything that just happened, and `redo` to replay it:

```ts
applyPatches(state, undo);
state.name; // "Alice"
state.tags; // ["admin"]

applyPatches(state, redo);
state.name; // "Bob"
state.tags; // ["admin", "editor"]
```

This works with any object type — classes, nested objects, Maps, Sets, arrays. The patches are plain JSON-serializable data, so you can store them, send them over the wire, or build a full undo history stack on top of them.

No copies of your objects are ever made. All original references are preserved — if you undo the removal of an item from an array, the restored item is the exact same object (`===`), not a clone.

## Why

Undo/redo typically requires either immutable state (snapshots, structural sharing) or manual inverse operations. Both get complex when your state involves class instances, Maps, Sets, or deep nesting.

`updatepatch` takes a different approach — mutations happen directly on your objects through a recording proxy. The proxy captures what changed and produces patches that can reverse or replay the operation. The objects themselves stay as-is: same classes, same prototypes, same references.

- **Mutate in place.** No immutable copies or frozen state trees. Your objects remain your objects.
- **Patches are data.** Undo and redo are `Patch[]` arrays — store them, serialize them, send them over the wire.
- **References are preserved.** Undo restores the exact same object references, not deep clones.

## Install

```bash
npm install updatepatch
```

## API

### `updateWithUndo(target, recipe)`

```ts
function updateWithUndo<T extends object>(
  target: T,
  recipe: (draft: T) => void,
): [undo: Patch[], redo: Patch[]]
```

`target` is the object to mutate — plain object, class instance, array, Map, or Set.

`recipe` receives a `draft` proxy over `target`. Reads return current values (nested proxies for objects). Writes mutate the underlying object and record patches.

Returns `[undo, redo]`. Apply `undo` to reverse, `redo` to replay.

```ts
updateWithUndo(state, (draft) => {
  // reads
  console.log(draft.score); // 100

  // writes — mutates state.score AND records a patch
  draft.score = 200;

  // reads reflect the mutation
  console.log(draft.score); // 200

  // works recursively through nested objects, arrays, Maps, Sets
  draft.player.inventory.push(sword);
  draft.metadata.set("updatedAt", Date.now());
  draft.flags.add("dirty");
});
```

No-op writes (same value) are skipped — no patches generated.

### `applyPatches(target, patches)`

```ts
function applyPatches<T extends object>(target: T, patches: Patch[]): T
```

Applies patches to `target` in place. Returns `target` for chaining.

### `Patch`

```ts
interface Patch {
  op: "replace" | "remove" | "add";
  path: (string | number)[];
  value?: any;
}
```

`path` is an array of keys from root to target property. Array indices are numbers, object/Map keys are strings.

```ts
{ op: "replace", path: ["player", "hp"], value: 50 }   // draft.player.hp = 50
{ op: "add",     path: ["items", 2],     value: "sword" } // draft.items.push("sword")
{ op: "remove",  path: ["tempData"] }                   // delete draft.tempData
```

### `Recipe<T>`

```ts
type Recipe<T> = (draft: T) => void;
```

## Supported types

- Plain objects and class instances (prototype preserved)
- `accessor` keyword (auto-accessors with private backing fields)
- Arrays — direct index access and methods: `push`, `pop`, `splice`, `shift`, `unshift`, `sort`, `reverse`
- `Map` — `get`, `set`, `delete`, `clear`
- `Set` — `add`, `delete`, `clear`
- Property addition and deletion
- Nested objects at any depth

Iteration over Maps and Sets (`for...of`, `.forEach()`, `.values()`, `.entries()`) returns proxied values, so nested mutations during iteration are tracked:

```ts
updateWithUndo(state, (draft) => {
  for (const [key, user] of draft.users) {
    user.lastSeen = now; // tracked
  }

  draft.scores.forEach((item, i) => {
    if (i % 2 === 0) item.value *= 2; // tracked
  });
});
```

## Undo stack example

```ts
import { updateWithUndo, applyPatches, Patch } from "updatepatch";

type Entry = { undo: Patch[]; redo: Patch[] };
const history: Entry[] = [];
let cursor = -1;

function update<T extends object>(target: T, recipe: (draft: T) => void) {
  const [undo, redo] = updateWithUndo(target, recipe);
  history.length = cursor + 1;
  history.push({ undo, redo });
  cursor++;
}

function undo<T extends object>(target: T) {
  if (cursor < 0) return;
  applyPatches(target, history[cursor].undo);
  cursor--;
}

function redo<T extends object>(target: T) {
  if (cursor >= history.length - 1) return;
  cursor++;
  applyPatches(target, history[cursor].redo);
}
```

## How it works

1. `updateWithUndo` wraps `target` in a `Proxy`. Nested objects get their own proxies on access.
2. Every write, delete, or collection mutation records two patches — one for undo, one for redo.
3. Array methods (`push`, `splice`, etc.) are intercepted at the method level so compound operations produce clean, minimal patches.
4. Map/Set iteration wraps yielded values in proxies so nested mutations during `for...of` / `.forEach()` are tracked.
5. When the recipe returns, undo patches are reversed (so they apply in correct order) and both lists are returned.

## License

[MIT](./LICENSE)
