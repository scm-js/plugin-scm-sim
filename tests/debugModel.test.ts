import { describe, expect, it } from "vitest";
import { editorRows, outcomes, Passes, tally, trigRecords, type Pass } from "../src/debugModel";

/** A pass from records `[copy, slot, type, answer]` (an action's slot as 16 + its own). */
const pass = (frame: number, recs: [number, number, number, number][], flags?: number[]): Pass => ({
  frame,
  records: Int32Array.from(recs.flatMap(([copy, slot, type, answer]) => [frame, copy, slot, type, answer, 0])),
  flags: flags ? Uint8Array.from(flags) : null,
  action: null,
});

describe("what became of each copy in a pass", () => {
  it("tells fired, held, went on, stopped, done and idle apart", () => {
    const p = pass(27, [
      [0, 0, 22, 1], [0, 16, 45, 1],                 // copy 0: Always, Set Deaths — fired
      [1, 0, 22, 1], [1, 16, 45, 1], [1, 17, 4, 0],  // copy 1: fired and held at its Wait
      [2, 17, 4, 1], [2, 18, 45, 1],                 // copy 2: went on from its Wait and finished
      [3, 0, 22, 1], [3, 1, 15, 0],                  // copy 3: the second condition did not hold
      [4, 18, 7, 0],                                 // copy 4: still held at a Transmission
    ], [4, 1, 1, 0, 1, 8, 4]);
    expect(outcomes(p, 7)).toEqual([
      { kind: "fired" },
      { kind: "held", slot: 1, type: 4, fired: true },
      { kind: "wenton" },
      { kind: "stopped", slot: 1, type: 15 },
      { kind: "held", slot: 2, type: 7, fired: false },
      { kind: "done" },
      { kind: "idle" },
    ]);
    expect(tally(outcomes(p, 7))).toEqual({ fired: 2, held: 2, stopped: 1 });
  });
});

describe("the passes as they come", () => {
  it("lets the later ones go when the game goes back", () => {
    const passes = new Passes();
    for (const f of [2, 33, 64, 95]) passes.add(pass(f, []));
    passes.rewound(40);
    expect(passes.frames()).toEqual([2, 33]);
  });
});

/** A CHK of named sections. */
const chk = (...sections: [string, Uint8Array][]) => {
  const out: number[] = [];
  for (const [name, data] of sections) {
    out.push(...[...name].map((c) => c.charCodeAt(0)));
    const size = new Uint8Array(4); new DataView(size.buffer).setInt32(0, data.length, true);
    out.push(...size, ...data);
  }
  return Uint8Array.from(out);
};
const record = (mark: number) => { const r = new Uint8Array(2400); r[0] = mark; return r; };
const join = (...rs: Uint8Array[]) => { const out = new Uint8Array(rs.length * 2400); rs.forEach((r, i) => out.set(r, i * 2400)); return out; };

describe("the editor's rows of the built map", () => {
  it("reads TRIG out of a CHK and matches each built row to the editor's, a build step's rows to none", () => {
    const editor = trigRecords(chk(["VER ", new Uint8Array(2)], ["TRIG", join(record(1), record(2), record(3))]));
    expect(editor.map((r) => r[0])).toEqual([1, 2, 3]);
    const built = trigRecords(chk(["TRIG", join(record(1), record(9), record(2), record(3), record(9))]));
    expect(editorRows(built, editor)).toEqual([0, null, 1, 2, null]);
  });
});
