/**
 * What the trigger debugger shows, worked out from what the play page says (`src/debug.ts` draws it): each pass of the
 * triggers as the game ran it, what became of each copy of a trigger in it, and which row of the editor's trigger
 * list a row of the built map is. No DOM here, so it is tested on its own.
 *
 * The play page sends a pass as the engine notes it (scm-sim `src/exact/triggerTrace.ts`): six ints a record — frame,
 * copy, slot (an action's is 16 + its slot), type, answer, the trigger's flags as it was called — and every copy's flags
 * and current action after the pass. A copy is one player's copy of a row of the built map's TRIG.
 */

/** Ints a record takes in a pass's `records`. */
export const STRIDE = 6;
/** A TRIG record's bytes. */
const RECORD = 2400;

/** One player's copy of a trigger of the built map: its player (0-based), its place in that player's list, its row. */
export interface TriggerCopy { player: number; place: number; row: number }

export interface Pass {
  frame: number;
  records: Int32Array;
  /** Every copy's flags (1 running, 4 preserved, 8 done) and current action after the pass; null when not sent. */
  flags: Uint8Array | null;
  action: Uint8Array | null;
}

/**
 * What became of a copy in a pass:
 * - `fired`: its conditions held and its actions ran to the end;
 * - `held`: an action stopped it (a Wait, a Transmission running), to be taken up again; `fired` says whether its
 *   conditions were asked and held in this pass (it began now) or it went on from an earlier one;
 * - `wenton`: it went on from where an earlier pass held it and finished;
 * - `stopped`: a condition did not hold (`slot`, `type`), and the asking ended there;
 * - `done`: it had fired before and is not preserved, so the game passes it by;
 * - `idle`: nothing was asked of it in this pass.
 */
export type Outcome =
  | { kind: "fired" | "wenton" }
  | { kind: "held"; slot: number; type: number; fired: boolean }
  | { kind: "stopped"; slot: number; type: number }
  | { kind: "done" | "idle" };

/** A record read out of a pass. */
export interface Record { copy: number; action: boolean; slot: number; type: number; answer: number }

export function records(pass: Pass): Record[] {
  const r = pass.records, out: Record[] = [];
  for (let i = 0; i + STRIDE <= r.length; i += STRIDE) {
    const slot = r[i + 2], action = slot >= 16;
    out.push({ copy: r[i + 1], action, slot: action ? slot - 16 : slot, type: r[i + 3], answer: r[i + 4] });
  }
  return out;
}

/** What became of every copy in a pass, in the order of `copies`. */
export function outcomes(pass: Pass, copies: number): Outcome[] {
  const by: Record[][] = Array.from({ length: copies }, () => []);
  for (const r of records(pass)) if (r.copy >= 0 && r.copy < copies) by[r.copy].push(r);
  return by.map((rs, copy): Outcome => {
    if (!rs.length) return { kind: pass.flags && pass.flags[copy] & 8 ? "done" : "idle" };
    const conditions = rs.filter((r) => !r.action), actions = rs.filter((r) => r.action);
    if (actions.length) {
      const last = actions[actions.length - 1];
      if (last.answer === 0) return { kind: "held", slot: last.slot, type: last.type, fired: conditions.length > 0 };
      return { kind: conditions.length ? "fired" : "wenton" };
    }
    const failed = conditions.find((r) => r.answer === 0);
    return failed ? { kind: "stopped", slot: failed.slot, type: failed.type } : { kind: "fired" };
  });
}

/** How many copies came to each kind in a pass: what the timeline draws for it. */
export function tally(list: readonly Outcome[]): { fired: number; held: number; stopped: number } {
  const t = { fired: 0, held: 0, stopped: 0 };
  for (const o of list) { if (o.kind === "fired" || o.kind === "wenton") t.fired++; else if (o.kind === "held") t.held++; else if (o.kind === "stopped") t.stopped++; }
  return t;
}

/** The passes of the game on the page, as they come; going back lets the later ones go (they come again). */
export class Passes {
  private readonly byFrame = new Map<number, Pass>();
  add(pass: Pass): void { this.byFrame.set(pass.frame, pass); }
  rewound(frame: number): void { for (const f of [...this.byFrame.keys()]) if (f > frame) this.byFrame.delete(f); }
  clear(): void { this.byFrame.clear(); }
  get(frame: number): Pass | null { return this.byFrame.get(frame) ?? null; }
  /** The frames passes ran in, in order. */
  frames(): number[] { return [...this.byFrame.keys()].sort((a, b) => a - b); }
}

/** A CHK's TRIG records, every TRIG section's in order (as the game reads them). */
export function trigRecords(chk: Uint8Array): Uint8Array[] {
  const view = new DataView(chk.buffer, chk.byteOffset, chk.byteLength), out: Uint8Array[] = [];
  for (let at = 0; at + 8 <= chk.length;) {
    const name = String.fromCharCode(chk[at], chk[at + 1], chk[at + 2], chk[at + 3]), size = view.getInt32(at + 4, true);
    at += 8;
    if (size < 0) continue;
    const end = Math.min(chk.length, at + size);
    if (name === "TRIG") for (let r = at; r + RECORD <= end; r += RECORD) out.push(chk.subarray(r, r + RECORD));
    at = end;
  }
  return out;
}

/**
 * For each row of the built map's TRIG, the editor's row it is (null: a row a build step added, such as a TrigScript
 * program's). Build steps add rows and leave the editor's as they were, in order, so each built row is matched to the
 * editor's next row with the same bytes.
 */
export function editorRows(built: readonly Uint8Array[], editor: readonly Uint8Array[]): (number | null)[] {
  const same = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  let next = 0;
  return built.map((b) => {
    for (let j = next; j < editor.length; j++) if (same(b, editor[j])) { next = j + 1; return j; }
    return null;
  });
}
