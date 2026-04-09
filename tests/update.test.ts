import { updateWithUndo, applyPatches, Patch } from "../src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class Foo {
  bar = "bar";
  baz = ["baz"];
}

class Nested {
  name = "root";
  child = { x: 1, y: 2 };
  items = [10, 20, 30];
}

// ---------------------------------------------------------------------------
// Basic property mutations
// ---------------------------------------------------------------------------

describe("basic property mutations", () => {
  test("replace a primitive property on a class instance", () => {
    const obj = new Foo();
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.bar = "baz";
    });

    expect(obj.bar).toBe("baz");

    applyPatches(obj, undo);
    expect(obj.bar).toBe("bar");

    applyPatches(obj, redo);
    expect(obj.bar).toBe("baz");
  });

  test("push to an array", () => {
    const obj = new Foo();
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.baz.push("qux");
    });

    expect(obj.baz).toEqual(["baz", "qux"]);

    applyPatches(obj, undo);
    expect(obj.baz).toEqual(["baz"]);

    applyPatches(obj, redo);
    expect(obj.baz).toEqual(["baz", "qux"]);
  });

  test("multiple mutations in one recipe", () => {
    const obj = new Foo();
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.bar = "changed";
      draft.baz.push("one");
      draft.baz.push("two");
    });

    expect(obj.bar).toBe("changed");
    expect(obj.baz).toEqual(["baz", "one", "two"]);

    applyPatches(obj, undo);
    expect(obj.bar).toBe("bar");
    expect(obj.baz).toEqual(["baz"]);

    applyPatches(obj, redo);
    expect(obj.bar).toBe("changed");
    expect(obj.baz).toEqual(["baz", "one", "two"]);
  });

  test("reading from draft returns current values", () => {
    const obj = { a: 1, b: 2 };
    updateWithUndo(obj, (draft) => {
      expect(draft.a).toBe(1);
      draft.a = 10;
      expect(draft.a).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// Nested objects
// ---------------------------------------------------------------------------

describe("nested object mutations", () => {
  test("mutate nested object property", () => {
    const obj = new Nested();
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.child.x = 99;
    });

    expect(obj.child.x).toBe(99);

    applyPatches(obj, undo);
    expect(obj.child.x).toBe(1);

    applyPatches(obj, redo);
    expect(obj.child.x).toBe(99);
  });

  test("replace array element by index", () => {
    const obj = new Nested();
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.items[1] = 999;
    });

    expect(obj.items).toEqual([10, 999, 30]);

    applyPatches(obj, undo);
    expect(obj.items).toEqual([10, 20, 30]);

    applyPatches(obj, redo);
    expect(obj.items).toEqual([10, 999, 30]);
  });

  test("deeply nested mutation", () => {
    const obj = { a: { b: { c: { d: "deep" } } } };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.a.b.c.d = "deeper";
    });

    expect(obj.a.b.c.d).toBe("deeper");

    applyPatches(obj, undo);
    expect(obj.a.b.c.d).toBe("deep");

    applyPatches(obj, redo);
    expect(obj.a.b.c.d).toBe("deeper");
  });
});

// ---------------------------------------------------------------------------
// Add / remove properties
// ---------------------------------------------------------------------------

describe("add and remove properties", () => {
  test("add a new property", () => {
    const obj: Record<string, any> = { existing: true };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.newProp = "hello";
    });

    expect(obj.newProp).toBe("hello");

    applyPatches(obj, undo);
    expect(obj.newProp).toBeUndefined();
    expect("newProp" in obj).toBe(false);

    applyPatches(obj, redo);
    expect(obj.newProp).toBe("hello");
  });

  test("delete a property", () => {
    const obj: Record<string, any> = { a: 1, b: 2 };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      delete draft.b;
    });

    expect(obj.b).toBeUndefined();
    expect("b" in obj).toBe(false);

    applyPatches(obj, undo);
    expect(obj.b).toBe(2);

    applyPatches(obj, redo);
    expect("b" in obj).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Array operations
// ---------------------------------------------------------------------------

describe("array operations", () => {
  test("splice removes and undo restores", () => {
    const obj = { arr: [1, 2, 3, 4, 5] };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.splice(1, 2);
    });

    expect(obj.arr).toEqual([1, 4, 5]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([1, 2, 3, 4, 5]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([1, 4, 5]);
  });

  test("unshift prepends and undo removes", () => {
    const obj = { arr: [2, 3] };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.unshift(1);
    });

    expect(obj.arr).toEqual([1, 2, 3]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([2, 3]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([1, 2, 3]);
  });

  test("pop removes last element", () => {
    const obj = { arr: [1, 2, 3] };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.pop();
    });

    expect(obj.arr).toEqual([1, 2]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([1, 2, 3]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

describe("Map operations", () => {
  test("set a new key", () => {
    const obj = { m: new Map<string, number>([["a", 1]]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.m.set("b", 2);
    });

    expect(obj.m.get("b")).toBe(2);
    expect(obj.m.size).toBe(2);

    applyPatches(obj, undo);
    expect(obj.m.has("b")).toBe(false);
    expect(obj.m.size).toBe(1);

    applyPatches(obj, redo);
    expect(obj.m.get("b")).toBe(2);
  });

  test("replace an existing key", () => {
    const obj = { m: new Map([["x", 10]]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.m.set("x", 20);
    });

    expect(obj.m.get("x")).toBe(20);

    applyPatches(obj, undo);
    expect(obj.m.get("x")).toBe(10);

    applyPatches(obj, redo);
    expect(obj.m.get("x")).toBe(20);
  });

  test("delete a key", () => {
    const obj = { m: new Map([["a", 1], ["b", 2]]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.m.delete("a");
    });

    expect(obj.m.has("a")).toBe(false);

    applyPatches(obj, undo);
    expect(obj.m.get("a")).toBe(1);

    applyPatches(obj, redo);
    expect(obj.m.has("a")).toBe(false);
  });

  test("clear a map", () => {
    const obj = { m: new Map([["a", 1], ["b", 2], ["c", 3]]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.m.clear();
    });

    expect(obj.m.size).toBe(0);

    applyPatches(obj, undo);
    expect(obj.m.size).toBe(3);
    expect(obj.m.get("a")).toBe(1);
    expect(obj.m.get("b")).toBe(2);
    expect(obj.m.get("c")).toBe(3);

    applyPatches(obj, redo);
    expect(obj.m.size).toBe(0);
  });

  test("nested object values in map", () => {
    const obj = { m: new Map<string, { val: number }>([["k", { val: 1 }]]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.m.get("k")!.val = 42;
    });

    expect(obj.m.get("k")!.val).toBe(42);

    applyPatches(obj, undo);
    expect(obj.m.get("k")!.val).toBe(1);

    applyPatches(obj, redo);
    expect(obj.m.get("k")!.val).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

describe("Set operations", () => {
  test("add a value", () => {
    const obj = { s: new Set([1, 2]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.s.add(3);
    });

    expect(obj.s.has(3)).toBe(true);
    expect(obj.s.size).toBe(3);

    applyPatches(obj, undo);
    expect(obj.s.has(3)).toBe(false);
    expect(obj.s.size).toBe(2);

    applyPatches(obj, redo);
    expect(obj.s.has(3)).toBe(true);
  });

  test("adding duplicate is no-op", () => {
    const obj = { s: new Set([1, 2]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.s.add(1);
    });

    expect(obj.s.size).toBe(2);
    expect(undo).toHaveLength(0);
    expect(redo).toHaveLength(0);
  });

  test("delete a value", () => {
    const obj = { s: new Set([1, 2, 3]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.s.delete(2);
    });

    expect(obj.s.has(2)).toBe(false);
    expect(obj.s.size).toBe(2);

    applyPatches(obj, undo);
    expect(obj.s.has(2)).toBe(true);
    expect(obj.s.size).toBe(3);

    applyPatches(obj, redo);
    expect(obj.s.has(2)).toBe(false);
  });

  test("clear a set", () => {
    const obj = { s: new Set(["a", "b", "c"]) };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.s.clear();
    });

    expect(obj.s.size).toBe(0);

    applyPatches(obj, undo);
    expect(obj.s.size).toBe(3);
    expect(obj.s.has("a")).toBe(true);

    applyPatches(obj, redo);
    expect(obj.s.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Patch format
// ---------------------------------------------------------------------------

describe("patch format", () => {
  test("patch has target and single-key path", () => {
    const obj = { a: 1 };
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.a = 2;
    });

    expect(undo).toEqual([{ op: "replace", target: obj, path: "a", value: 1 }]);
    expect(redo).toEqual([{ op: "replace", target: obj, path: "a", value: 2 }]);
  });

  test("nested mutation targets the inner object directly", () => {
    const obj = { a: { b: { c: 0 } } };
    const [_undo, redo] = updateWithUndo(obj, (draft) => {
      draft.a.b.c = 1;
    });

    expect(redo[0].target).toBe(obj.a.b);
    expect(redo[0].path).toBe("c");
  });

  test("array index paths are numbers", () => {
    const obj = { arr: [10, 20] };
    const [_undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr[0] = 99;
    });

    expect(redo[0].target).toBe(obj.arr);
    expect(redo[0].path).toBe(0);
    expect(typeof redo[0].path).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Class instance preservation
// ---------------------------------------------------------------------------

describe("class instance preservation", () => {
  test("mutated object retains its prototype", () => {
    const obj = new Foo();
    updateWithUndo(obj, (draft) => {
      draft.bar = "changed";
    });

    expect(obj).toBeInstanceOf(Foo);
    expect(Object.getPrototypeOf(obj)).toBe(Foo.prototype);
  });

  test("undo restores prototype chain", () => {
    class Custom {
      value = 10;
      double() { return this.value * 2; }
    }

    const obj = new Custom();
    const [undo] = updateWithUndo(obj, (draft) => {
      draft.value = 20;
    });

    expect(obj.value).toBe(20);
    applyPatches(obj, undo);
    expect(obj.value).toBe(10);
    expect(obj.double()).toBe(20);
    expect(obj).toBeInstanceOf(Custom);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("no mutations produces empty patches", () => {
    const obj = { a: 1 };
    const [undo, redo] = updateWithUndo(obj, (_draft) => {
      // no-op
    });

    expect(undo).toEqual([]);
    expect(redo).toEqual([]);
  });

  test("setting same value is a no-op", () => {
    const obj = { a: 1, ref: { x: 1 } };
    const ref = obj.ref;
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.a = 1;
      draft.ref = ref;
    });

    expect(undo).toHaveLength(0);
    expect(redo).toHaveLength(0);
  });

  test("undo restores original references, not copies", () => {
    class Item {
      constructor(public name: string) {}
    }

    const a = new Item("a");
    const b = new Item("b");
    const obj = { items: [a, b] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.items.splice(1, 1); // remove b
    });

    expect(obj.items).toEqual([a]);

    // Undo — b should be the exact same reference
    applyPatches(obj, undo);
    expect(obj.items).toHaveLength(2);
    expect(obj.items[0]).toBe(a);
    expect(obj.items[1]).toBe(b);

    // Redo — a remains the same reference
    applyPatches(obj, redo);
    expect(obj.items).toHaveLength(1);
    expect(obj.items[0]).toBe(a);
  });

  test("multiple sequential update+undo cycles", () => {
    const obj = { count: 0 };

    const [undo1] = updateWithUndo(obj, (d) => { d.count = 1; });
    const [undo2] = updateWithUndo(obj, (d) => { d.count = 2; });
    const [undo3] = updateWithUndo(obj, (d) => { d.count = 3; });

    expect(obj.count).toBe(3);

    applyPatches(obj, undo3);
    expect(obj.count).toBe(2);

    applyPatches(obj, undo2);
    expect(obj.count).toBe(1);

    applyPatches(obj, undo1);
    expect(obj.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Complex scenario
// ---------------------------------------------------------------------------

describe("complex scenario: full undo/redo round-trip", () => {
  test("class with mixed types", () => {
    class AppState {
      title = "untitled";
      tags = ["draft"];
      metadata = new Map<string, string>([["author", "alice"]]);
      flags = new Set(["active"]);
      nested = { score: 0, details: { notes: "none" } };
    }

    const state = new AppState();

    const [undo, redo] = updateWithUndo(state, (draft) => {
      draft.title = "My Document";
      draft.tags.push("published");
      draft.metadata.set("author", "bob");
      draft.metadata.set("version", "1.0");
      draft.flags.add("reviewed");
      draft.nested.score = 95;
      draft.nested.details.notes = "excellent";
    });

    // Verify mutations applied
    expect(state.title).toBe("My Document");
    expect(state.tags).toEqual(["draft", "published"]);
    expect(state.metadata.get("author")).toBe("bob");
    expect(state.metadata.get("version")).toBe("1.0");
    expect(state.flags.has("reviewed")).toBe(true);
    expect(state.nested.score).toBe(95);
    expect(state.nested.details.notes).toBe("excellent");

    // Undo everything
    applyPatches(state, undo);
    expect(state.title).toBe("untitled");
    expect(state.tags).toEqual(["draft"]);
    expect(state.metadata.get("author")).toBe("alice");
    expect(state.metadata.has("version")).toBe(false);
    expect(state.flags.has("reviewed")).toBe(false);
    expect(state.nested.score).toBe(0);
    expect(state.nested.details.notes).toBe("none");

    // Redo everything
    applyPatches(state, redo);
    expect(state.title).toBe("My Document");
    expect(state.tags).toEqual(["draft", "published"]);
    expect(state.metadata.get("author")).toBe("bob");
    expect(state.metadata.get("version")).toBe("1.0");
    expect(state.flags.has("reviewed")).toBe(true);
    expect(state.nested.score).toBe(95);
    expect(state.nested.details.notes).toBe("excellent");

    // Still an AppState instance
    expect(state).toBeInstanceOf(AppState);
  });
});

// ---------------------------------------------------------------------------
// Auto-accessor keyword
// ---------------------------------------------------------------------------

describe("auto-accessor properties", () => {
  test("basic accessor mutation with undo/redo", () => {
    class Widget {
      accessor label = "untitled";
      accessor count = 0;
    }

    const w = new Widget();
    const [undo, redo] = updateWithUndo(w, (draft) => {
      draft.label = "button";
      draft.count = 5;
    });

    expect(w.label).toBe("button");
    expect(w.count).toBe(5);

    applyPatches(w, undo);
    expect(w.label).toBe("untitled");
    expect(w.count).toBe(0);

    applyPatches(w, redo);
    expect(w.label).toBe("button");
    expect(w.count).toBe(5);
  });

  test("accessor with object value preserves reference", () => {
    class Container {
      accessor data = { x: 1, y: 2 };
    }

    const original = { x: 10, y: 20 };
    const c = new Container();
    c.data = original;

    const replacement = { x: 99, y: 99 };
    const [undo, redo] = updateWithUndo(c, (draft) => {
      draft.data = replacement;
    });

    expect(c.data).toBe(replacement);

    applyPatches(c, undo);
    expect(c.data).toBe(original);

    applyPatches(c, redo);
    expect(c.data).toBe(replacement);
  });

  test("nested read through accessor returns proxy", () => {
    class Model {
      accessor config = { theme: "light", font: "mono" };
    }

    const m = new Model();
    const [undo, redo] = updateWithUndo(m, (draft) => {
      draft.config.theme = "dark";
    });

    expect(m.config.theme).toBe("dark");
    expect(m.config.font).toBe("mono"); // untouched

    applyPatches(m, undo);
    expect(m.config.theme).toBe("light");

    applyPatches(m, redo);
    expect(m.config.theme).toBe("dark");
  });

  test("mix of accessor and regular properties", () => {
    class Mixed {
      accessor title = "hello";
      tags = ["a"];
      accessor visible = true;
    }

    const obj = new Mixed();
    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.title = "goodbye";
      draft.tags.push("b");
      draft.visible = false;
    });

    expect(obj.title).toBe("goodbye");
    expect(obj.tags).toEqual(["a", "b"]);
    expect(obj.visible).toBe(false);

    applyPatches(obj, undo);
    expect(obj.title).toBe("hello");
    expect(obj.tags).toEqual(["a"]);
    expect(obj.visible).toBe(true);

    applyPatches(obj, redo);
    expect(obj.title).toBe("goodbye");
    expect(obj.tags).toEqual(["a", "b"]);
    expect(obj.visible).toBe(false);
  });

  test("reading accessor in recipe returns current value", () => {
    class Counter {
      accessor value = 10;
    }

    const c = new Counter();
    updateWithUndo(c, (draft) => {
      expect(draft.value).toBe(10);
      draft.value = 20;
      expect(draft.value).toBe(20);
    });
  });

  test("multiple sequential updates on accessor", () => {
    class State {
      accessor step = 0;
    }

    const s = new State();
    const [undo1] = updateWithUndo(s, (d) => { d.step = 1; });
    const [undo2] = updateWithUndo(s, (d) => { d.step = 2; });
    const [undo3] = updateWithUndo(s, (d) => { d.step = 3; });

    expect(s.step).toBe(3);

    applyPatches(s, undo3);
    expect(s.step).toBe(2);

    applyPatches(s, undo2);
    expect(s.step).toBe(1);

    applyPatches(s, undo1);
    expect(s.step).toBe(0);
  });

  test("accessor array property", () => {
    class List {
      accessor items: string[] = [];
    }

    const list = new List();
    const original = ["x", "y"];
    list.items = original;

    const [undo, redo] = updateWithUndo(list, (draft) => {
      draft.items.push("z");
    });

    expect(list.items).toEqual(["x", "y", "z"]);
    expect(list.items).toBe(original); // same array reference, mutated in-place

    applyPatches(list, undo);
    expect(list.items).toEqual(["x", "y"]);

    applyPatches(list, redo);
    expect(list.items).toEqual(["x", "y", "z"]);
  });
});

// ---------------------------------------------------------------------------
// Array non-mutating methods inside recipe
// ---------------------------------------------------------------------------

describe("array read methods inside recipe", () => {
  test("forEach iterates with correct values", () => {
    const obj = { items: [10, 20, 30] };
    const collected: number[] = [];

    updateWithUndo(obj, (draft) => {
      draft.items.forEach((v) => collected.push(v));
    });

    expect(collected).toEqual([10, 20, 30]);
  });

  test("map returns transformed values", () => {
    const obj = { items: [1, 2, 3] };
    let doubled: number[] = [];

    updateWithUndo(obj, (draft) => {
      doubled = draft.items.map((v) => v * 2);
    });

    expect(doubled).toEqual([2, 4, 6]);
  });

  test("filter selects matching elements", () => {
    const obj = { items: [1, 2, 3, 4, 5] };
    let evens: number[] = [];

    updateWithUndo(obj, (draft) => {
      evens = draft.items.filter((v) => v % 2 === 0);
    });

    expect(evens).toEqual([2, 4]);
  });

  test("find and findIndex", () => {
    const obj = { items: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    let found: { id: string } | undefined;
    let idx = -1;

    updateWithUndo(obj, (draft) => {
      found = draft.items.find((v) => v.id === "b");
      idx = draft.items.findIndex((v) => v.id === "c");
    });

    expect(found).toEqual({ id: "b" });
    expect(idx).toBe(2);
  });

  test("reduce accumulates values", () => {
    const obj = { items: [1, 2, 3, 4] };
    let sum = 0;

    updateWithUndo(obj, (draft) => {
      sum = draft.items.reduce((acc, v) => acc + v, 0);
    });

    expect(sum).toBe(10);
  });

  test("some and every", () => {
    const obj = { items: [2, 4, 6, 7] };
    let hasOdd = false;
    let allEven = false;

    updateWithUndo(obj, (draft) => {
      hasOdd = draft.items.some((v) => v % 2 !== 0);
      allEven = draft.items.every((v) => v % 2 === 0);
    });

    expect(hasOdd).toBe(true);
    expect(allEven).toBe(false);
  });

  test("includes and indexOf", () => {
    const obj = { items: ["a", "b", "c"] };
    let has = false;
    let idx = -1;

    updateWithUndo(obj, (draft) => {
      has = draft.items.includes("b");
      idx = draft.items.indexOf("c");
    });

    expect(has).toBe(true);
    expect(idx).toBe(2);
  });

  test("forEach mutating nested objects with undo/redo", () => {
    const obj = {
      items: [{ val: 1 }, { val: 2 }, { val: 3 }, { val: 4 }],
    };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.items.forEach((item, i) => {
        if (i % 2 === 0) item.val *= 10;
      });
    });

    expect(obj.items.map((i) => i.val)).toEqual([10, 2, 30, 4]);

    applyPatches(obj, undo);
    expect(obj.items.map((i) => i.val)).toEqual([1, 2, 3, 4]);

    applyPatches(obj, redo);
    expect(obj.items.map((i) => i.val)).toEqual([10, 2, 30, 4]);
  });

  test("for-of loop over array with nested mutation", () => {
    const obj = { items: [{ n: "a" }, { n: "b" }, { n: "c" }] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      for (const item of draft.items) {
        item.n = item.n.toUpperCase();
      }
    });

    expect(obj.items.map((i) => i.n)).toEqual(["A", "B", "C"]);

    applyPatches(obj, undo);
    expect(obj.items.map((i) => i.n)).toEqual(["a", "b", "c"]);

    applyPatches(obj, redo);
    expect(obj.items.map((i) => i.n)).toEqual(["A", "B", "C"]);
  });
});

// ---------------------------------------------------------------------------
// Set iteration with nested mutations
// ---------------------------------------------------------------------------

describe("Set iteration with nested mutations", () => {
  test("for-of over Set, modify every 2nd item", () => {
    const a = { id: 1, score: 10 };
    const b = { id: 2, score: 20 };
    const c = { id: 3, score: 30 };
    const d = { id: 4, score: 40 };
    const obj = { s: new Set([a, b, c, d]) };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      let i = 0;
      for (const item of draft.s) {
        if (i % 2 === 1) item.score = 0;
        i++;
      }
    });

    expect(a.score).toBe(10);
    expect(b.score).toBe(0);
    expect(c.score).toBe(30);
    expect(d.score).toBe(0);

    applyPatches(obj, undo);
    expect(a.score).toBe(10);
    expect(b.score).toBe(20);
    expect(c.score).toBe(30);
    expect(d.score).toBe(40);

    applyPatches(obj, redo);
    expect(b.score).toBe(0);
    expect(d.score).toBe(0);
  });

  test("Set.forEach modify every 2nd item", () => {
    const items = [{ v: "a" }, { v: "b" }, { v: "c" }, { v: "d" }];
    const obj = { s: new Set(items) };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      let i = 0;
      draft.s.forEach((item) => {
        if (i % 2 === 0) item.v = item.v.toUpperCase();
        i++;
      });
    });

    expect(items.map((x) => x.v)).toEqual(["A", "b", "C", "d"]);

    applyPatches(obj, undo);
    expect(items.map((x) => x.v)).toEqual(["a", "b", "c", "d"]);

    applyPatches(obj, redo);
    expect(items.map((x) => x.v)).toEqual(["A", "b", "C", "d"]);
  });

  test("Set.values() iteration with mutation", () => {
    const x = { n: 1 };
    const y = { n: 2 };
    const obj = { s: new Set([x, y]) };

    const [undo] = updateWithUndo(obj, (draft) => {
      for (const item of draft.s.values()) {
        item.n += 100;
      }
    });

    expect(x.n).toBe(101);
    expect(y.n).toBe(102);

    applyPatches(obj, undo);
    expect(x.n).toBe(1);
    expect(y.n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Map iteration with nested mutations
// ---------------------------------------------------------------------------

describe("Map iteration with nested mutations", () => {
  test("for-of over Map entries, modify every 2nd value", () => {
    const va = { count: 1 };
    const vb = { count: 2 };
    const vc = { count: 3 };
    const vd = { count: 4 };
    const obj = {
      m: new Map<string, { count: number }>([
        ["a", va], ["b", vb], ["c", vc], ["d", vd],
      ]),
    };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      let i = 0;
      for (const [_key, val] of draft.m) {
        if (i % 2 === 1) val.count = 0;
        i++;
      }
    });

    expect(va.count).toBe(1);
    expect(vb.count).toBe(0);
    expect(vc.count).toBe(3);
    expect(vd.count).toBe(0);

    applyPatches(obj, undo);
    expect(va.count).toBe(1);
    expect(vb.count).toBe(2);
    expect(vc.count).toBe(3);
    expect(vd.count).toBe(4);

    applyPatches(obj, redo);
    expect(vb.count).toBe(0);
    expect(vd.count).toBe(0);
  });

  test("Map.forEach modify every 2nd value", () => {
    const obj = {
      m: new Map<string, { val: number }>([
        ["x", { val: 10 }],
        ["y", { val: 20 }],
        ["z", { val: 30 }],
      ]),
    };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      let i = 0;
      draft.m.forEach((value) => {
        if (i % 2 === 0) value.val *= -1;
        i++;
      });
    });

    expect(obj.m.get("x")!.val).toBe(-10);
    expect(obj.m.get("y")!.val).toBe(20);
    expect(obj.m.get("z")!.val).toBe(-30);

    applyPatches(obj, undo);
    expect(obj.m.get("x")!.val).toBe(10);
    expect(obj.m.get("y")!.val).toBe(20);
    expect(obj.m.get("z")!.val).toBe(30);

    applyPatches(obj, redo);
    expect(obj.m.get("x")!.val).toBe(-10);
    expect(obj.m.get("z")!.val).toBe(-30);
  });

  test("Map.values() iteration with mutation", () => {
    const obj = {
      m: new Map<string, { n: number }>([
        ["a", { n: 1 }],
        ["b", { n: 2 }],
      ]),
    };

    const [undo] = updateWithUndo(obj, (draft) => {
      for (const val of draft.m.values()) {
        val.n += 100;
      }
    });

    expect(obj.m.get("a")!.n).toBe(101);
    expect(obj.m.get("b")!.n).toBe(102);

    applyPatches(obj, undo);
    expect(obj.m.get("a")!.n).toBe(1);
    expect(obj.m.get("b")!.n).toBe(2);
  });

  test("Map.entries() iteration with mutation", () => {
    const obj = {
      m: new Map<string, { flag: boolean }>([
        ["p", { flag: false }],
        ["q", { flag: false }],
      ]),
    };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      for (const [_key, val] of draft.m.entries()) {
        val.flag = true;
      }
    });

    expect(obj.m.get("p")!.flag).toBe(true);
    expect(obj.m.get("q")!.flag).toBe(true);

    applyPatches(obj, undo);
    expect(obj.m.get("p")!.flag).toBe(false);
    expect(obj.m.get("q")!.flag).toBe(false);

    applyPatches(obj, redo);
    expect(obj.m.get("p")!.flag).toBe(true);
    expect(obj.m.get("q")!.flag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coverage: array shift, sort, reverse
// ---------------------------------------------------------------------------

describe("array shift, sort, reverse", () => {
  test("shift removes first element with undo/redo", () => {
    const obj = { arr: ["a", "b", "c"] };
    let shifted: string | undefined;

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      shifted = draft.arr.shift();
    });

    expect(shifted).toBe("a");
    expect(obj.arr).toEqual(["b", "c"]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual(["a", "b", "c"]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual(["b", "c"]);
  });

  test("shift on empty array returns undefined", () => {
    const obj = { arr: [] as string[] };
    let shifted: string | undefined;

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      shifted = draft.arr.shift();
    });

    expect(shifted).toBeUndefined();
    expect(undo).toHaveLength(0);
    expect(redo).toHaveLength(0);
  });

  test("sort with undo/redo", () => {
    const obj = { arr: [3, 1, 4, 1, 5] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.sort((a, b) => a - b);
    });

    expect(obj.arr).toEqual([1, 1, 3, 4, 5]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([3, 1, 4, 1, 5]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([1, 1, 3, 4, 5]);
  });

  test("reverse with undo/redo", () => {
    const obj = { arr: [1, 2, 3, 4] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.reverse();
    });

    expect(obj.arr).toEqual([4, 3, 2, 1]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([1, 2, 3, 4]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([4, 3, 2, 1]);
  });

  test("sort with object references preserved", () => {
    const a = { name: "c" };
    const b = { name: "a" };
    const c = { name: "b" };
    const obj = { arr: [a, b, c] };

    const [undo] = updateWithUndo(obj, (draft) => {
      draft.arr.sort((x, y) => x.name.localeCompare(y.name));
    });

    expect(obj.arr).toEqual([b, c, a]);
    expect(obj.arr[0]).toBe(b);
    expect(obj.arr[1]).toBe(c);
    expect(obj.arr[2]).toBe(a);

    applyPatches(obj, undo);
    expect(obj.arr[0]).toBe(a);
    expect(obj.arr[1]).toBe(b);
    expect(obj.arr[2]).toBe(c);
  });
});

// ---------------------------------------------------------------------------
// Coverage: splice with insertions
// ---------------------------------------------------------------------------

describe("splice with insertions", () => {
  test("splice replace: remove and insert", () => {
    const obj = { arr: [1, 2, 3, 4, 5] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.splice(1, 2, 10, 20, 30);
    });

    expect(obj.arr).toEqual([1, 10, 20, 30, 4, 5]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([1, 2, 3, 4, 5]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([1, 10, 20, 30, 4, 5]);
  });

  test("splice insert only (deleteCount 0)", () => {
    const obj = { arr: ["a", "b"] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.splice(1, 0, "x", "y");
    });

    expect(obj.arr).toEqual(["a", "x", "y", "b"]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual(["a", "b"]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual(["a", "x", "y", "b"]);
  });

  test("splice with negative start", () => {
    const obj = { arr: [1, 2, 3, 4] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.splice(-2, 1, 99);
    });

    expect(obj.arr).toEqual([1, 2, 99, 4]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([1, 2, 3, 4]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([1, 2, 99, 4]);
  });
});

// ---------------------------------------------------------------------------
// Coverage: direct array length, delete, add
// ---------------------------------------------------------------------------

describe("direct array operations", () => {
  test("truncate array by setting length", () => {
    const obj = { arr: [1, 2, 3, 4, 5] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.arr.length = 2;
    });

    expect(obj.arr).toEqual([1, 2]);

    applyPatches(obj, undo);
    expect(obj.arr).toEqual([1, 2, 3, 4, 5]);

    applyPatches(obj, redo);
    expect(obj.arr).toEqual([1, 2]);
  });

  test("delete array element by index", () => {
    const obj = { arr: [10, 20, 30] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      delete draft.arr[1];
    });

    expect(1 in obj.arr).toBe(false);
    expect(obj.arr.length).toBe(3); // length unchanged, creates hole

    applyPatches(obj, undo);
    expect(obj.arr[1]).toBe(20);

    applyPatches(obj, redo);
    expect(1 in obj.arr).toBe(false);
  });

  test("add new index beyond current length", () => {
    const obj = { arr: [1, 2] };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      (draft as any).arr[5] = 99;
    });

    expect(obj.arr[5]).toBe(99);
    expect(obj.arr.length).toBe(6);

    applyPatches(obj, undo);
    expect(5 in obj.arr).toBe(false);

    applyPatches(obj, redo);
    expect(obj.arr[5]).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Coverage: Map/Set proxy methods not yet tested
// ---------------------------------------------------------------------------

describe("Map proxy: has and keys", () => {
  test("has() works through proxy", () => {
    const obj = { m: new Map([["a", 1], ["b", 2]]) };

    updateWithUndo(obj, (draft) => {
      expect(draft.m.has("a")).toBe(true);
      expect(draft.m.has("z")).toBe(false);
    });
  });

  test("keys() works through proxy", () => {
    const obj = { m: new Map([["x", 1], ["y", 2]]) };

    updateWithUndo(obj, (draft) => {
      const keys = Array.from(draft.m.keys());
      expect(keys).toEqual(["x", "y"]);
    });
  });
});

describe("Set proxy: has, keys, entries", () => {
  test("has() works through proxy", () => {
    const obj = { s: new Set([1, 2, 3]) };

    updateWithUndo(obj, (draft) => {
      expect(draft.s.has(2)).toBe(true);
      expect(draft.s.has(99)).toBe(false);
    });
  });

  test("keys() iterates through proxy", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const obj = { s: new Set([a, b]) };

    const [undo] = updateWithUndo(obj, (draft) => {
      for (const item of draft.s.keys()) {
        item.id += 10;
      }
    });

    expect(a.id).toBe(11);
    expect(b.id).toBe(12);

    applyPatches(obj, undo);
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  test("entries() iterates through proxy", () => {
    const x = { v: "a" };
    const y = { v: "b" };
    const obj = { s: new Set([x, y]) };

    const [undo] = updateWithUndo(obj, (draft) => {
      for (const [val] of draft.s.entries()) {
        val.v = val.v.toUpperCase();
      }
    });

    expect(x.v).toBe("A");
    expect(y.v).toBe("B");

    applyPatches(obj, undo);
    expect(x.v).toBe("a");
    expect(y.v).toBe("b");
  });
});


// ---------------------------------------------------------------------------
// Null-prototype objects (Object.create(null))
// ---------------------------------------------------------------------------

describe("Object.create(null)", () => {
  test("mutate top-level null-prototype object", () => {
    const obj = Object.create(null) as Record<string, any>;
    obj.x = 1;
    obj.y = 2;

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.x = 10;
      draft.y = 20;
    });

    expect(obj.x).toBe(10);
    expect(obj.y).toBe(20);

    applyPatches(obj, undo);
    expect(obj.x).toBe(1);
    expect(obj.y).toBe(2);

    applyPatches(obj, redo);
    expect(obj.x).toBe(10);
    expect(obj.y).toBe(20);
  });

  test("nested null-prototype object", () => {
    const inner = Object.create(null) as Record<string, any>;
    inner.val = "hello";
    const obj = { nested: inner };

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.nested.val = "world";
    });

    expect(inner.val).toBe("world");

    applyPatches(obj, undo);
    expect(inner.val).toBe("hello");

    applyPatches(obj, redo);
    expect(inner.val).toBe("world");
  });

  test("add and delete properties on null-prototype object", () => {
    const obj = Object.create(null) as Record<string, any>;
    obj.keep = true;

    const [undo, redo] = updateWithUndo(obj, (draft) => {
      draft.added = "new";
      delete draft.keep;
    });

    expect(obj.added).toBe("new");
    expect("keep" in obj).toBe(false);

    applyPatches(obj, undo);
    expect("added" in obj).toBe(false);
    expect(obj.keep).toBe(true);

    applyPatches(obj, redo);
    expect(obj.added).toBe("new");
    expect("keep" in obj).toBe(false);
  });
});
