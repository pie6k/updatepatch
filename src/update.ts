import { Patch, Recipe } from "./types";
import { createRecordingProxy, RecorderContext } from "./traps";

/**
 * Mutate `target` via `recipe`, returning [undoPatches, redoPatches].
 *
 * - The recipe callback receives a recording proxy.
 * - All mutations go through to the real object immediately.
 * - Undo patches reverse the mutations; redo patches replay them.
 */
export function updateWithUndo<T extends object>(
  target: T,
  recipe: Recipe<T>,
): [undo: Patch[], redo: Patch[]] {
  const ctx: RecorderContext = {
    undoPatches: [],
    redoPatches: [],
    proxies: new WeakMap(),
  };

  const draft = createRecordingProxy(target, [], ctx);
  recipe(draft);

  // Undo patches should be applied in reverse order
  ctx.undoPatches.reverse();

  return [ctx.undoPatches, ctx.redoPatches];
}
