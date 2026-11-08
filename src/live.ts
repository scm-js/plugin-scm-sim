/**
 * Live edit (scm-sim `web/livePatch.ts`, docs/mods-m5d.md there): a mod changed while a test game runs in the play
 * page's tab, and the running game takes the change at once. The conversation, in the tab `PlayTab` opened:
 *
 *   → `{ type: "scmjs.play.patch", id, fields: [{ table, id, field, part?, value }], files: [{ path, file }] }`
 *   ← `{ type: "scmjs.play.patched", id, applied, deferred, errors, frame? }`
 *   → `{ type: "scmjs.play.ask", id, what: "state" }`   ← `{ type: "scmjs.play.state", id, running, alone, frame, mod, waiting }`
 *   → `{ type: "scmjs.play.ask", id, what: "grafts" }`  ← `{ type: "scmjs.play.grafts", id, files: [{ path, bytes }], left }`
 *   ← `{ type: "scmjs.play.state", … }` without an id    said by the page whenever a game starts there
 *
 * Only a game played alone takes a patch: in a game between people the page answers every item as an error. A page
 * from before live edit answers nothing: a request then fails with the words `noAnswer`.
 */
import type { LiveAnswer, LiveField, LiveFile, LiveItem, LiveState } from "../contract";

export interface LiveWords {
  /** No play page's tab is open. */
  noTab: string;
  /** The page did not answer (a page from before live edit, or it was busy loading). */
  noAnswer: string;
}

/** Sends to the tab; false when there is no tab to send to. */
export type TabPost = (message: Record<string, unknown>) => boolean;

/** How long a question waits: a patch may load pictures and read tables, a state is quick. */
const WAIT = { patch: 20_000, state: 2_000, grafts: 10_000 } as const;

const items = (v: unknown): LiveItem[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && typeof (x as LiveItem).message === "string") as LiveItem[] : []);

/** The page's answer to a patch, read defensively. */
export function readAnswer(m: Record<string, unknown>): LiveAnswer {
  return { applied: items(m.applied), deferred: items(m.deferred), errors: items(m.errors), ...(typeof m.frame === "number" ? { frame: m.frame } : {}) };
}

/** The page's word on the game in front, read defensively; null when it is not one. */
export function readState(m: Record<string, unknown>): LiveState | null {
  if (typeof m.running !== "boolean") return null;
  const mod = m.mod as { hash?: unknown; name?: unknown } | null;
  return {
    running: m.running, alone: m.alone === true, frame: typeof m.frame === "number" ? m.frame : 0,
    mod: mod && typeof mod.hash === "string" ? { hash: mod.hash, name: typeof mod.name === "string" ? mod.name : mod.hash } : null,
    waiting: Array.isArray(m.waiting) ? m.waiting.filter((w): w is string => typeof w === "string") : [],
  };
}

/** Bytes as a `File` the page can read, named for its last path part. */
function fileOf(f: LiveFile): File {
  return new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split(/[\\/]/).pop() || "file");
}

export class LiveLink {
  private readonly post: TabPost;
  private readonly words: LiveWords;
  private readonly waiting = new Map<string, { type: string; resolve(m: Record<string, unknown>): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Set<(state: LiveState | null) => void>();
  private next = 1;
  /** What the page last said of its game, unasked or asked; null before it said anything, or once the tab closed. */
  last: LiveState | null = null;

  constructor(post: TabPost, words: LiveWords) { this.post = post; this.words = words; }

  /** A message from the tab (the caller checked it is the tab and the right origin). True when it was one of these. */
  heard(m: Record<string, unknown>): boolean {
    const type = m.type;
    if (type !== "scmjs.play.patched" && type !== "scmjs.play.state" && type !== "scmjs.play.grafts") return false;
    if (type === "scmjs.play.state") { const s = readState(m); if (s) this.tell(s); }
    const id = typeof m.id === "string" ? m.id : null, w = id ? this.waiting.get(id) : undefined;
    if (w && w.type === type) { this.waiting.delete(id!); clearTimeout(w.timer); w.resolve(m); }
    return true;
  }

  /** The tab closed or loaded again: nothing it was asked will be answered. */
  gone() {
    for (const [id, w] of this.waiting) { clearTimeout(w.timer); w.reject(new Error(this.words.noAnswer)); this.waiting.delete(id); }
    this.tell(null);
  }

  private tell(state: LiveState | null) {
    this.last = state;
    for (const l of this.listeners) l(state);
  }

  onState(listener: (state: LiveState | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private ask(type: "scmjs.play.patched" | "scmjs.play.state" | "scmjs.play.grafts", message: Record<string, unknown>, wait: number): Promise<Record<string, unknown>> {
    const id = `live-${this.next++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.waiting.delete(id)) reject(new Error(this.words.noAnswer)); }, wait);
      this.waiting.set(id, { type, resolve, reject, timer });
      if (!this.post({ ...message, id })) { clearTimeout(timer); this.waiting.delete(id); reject(new Error(this.words.noTab)); }
    });
  }

  /** What the page says of the game in front now; null when no tab is open or it does not answer. */
  async state(): Promise<LiveState | null> {
    // (`heard` has told the listeners already.)
    try { return readState(await this.ask("scmjs.play.state", { type: "scmjs.play.ask", what: "state" }, WAIT.state)); }
    catch { return null; }
  }

  /** Whether a game played alone is running in the tab: the only game a patch is taken by. */
  async playing(): Promise<boolean> { return (await this.state())?.alone === true; }

  /** Fields and files sent to the running game; the page's answer, item by item. */
  async patch(fields: readonly LiveField[], files: readonly LiveFile[] = []): Promise<LiveAnswer> {
    const m = await this.ask("scmjs.play.patched", { type: "scmjs.play.patch", fields: fields.map((f) => ({ ...f })), files: files.map((f) => ({ path: f.path, file: fileOf(f) })) }, WAIT.patch);
    return readAnswer(m);
  }

  /** The running game's button sets and requirement lists as `.graft` files (what a mod without its own starts from). */
  async grafts(): Promise<{ files: LiveFile[]; left: string[] }> {
    const m = await this.ask("scmjs.play.grafts", { type: "scmjs.play.ask", what: "grafts" }, WAIT.grafts);
    if (typeof m.error === "string") throw new Error(m.error);
    const files = Array.isArray(m.files) ? (m.files as { path?: unknown; bytes?: unknown }[]).filter((f) => typeof f.path === "string" && f.bytes instanceof Uint8Array).map((f) => ({ path: f.path as string, bytes: f.bytes as Uint8Array })) : [];
    return { files, left: Array.isArray(m.left) ? (m.left as unknown[]).filter((x): x is string => typeof x === "string") : [] };
  }
}
