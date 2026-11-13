/**
 * Where a mod's files come from when a page of the engine is to play with a mod it does not keep (0.19.0, scm-sim's
 * `modFiles`): the caller's own `ReplayDataSet.files`, else a mod another plugin has open and registered by its hash
 * (`ScmSimService.provideMod`: the Mod Editor's open mod, a folder Aftermath was given). The files are asked for only
 * when the page's `ready` says it does not keep that hash: gathering a large mod's files is not free.
 *
 * Keeping a large mod with plugins takes a page a minute or two, and every page of the site keeps it in the same
 * storage, so it is kept once: while one page keeps a hash, a request for it on another waits for that, then goes
 * without files (the page finds what the first kept).
 */
import type { Disposable, LiveFile, ModSourceFile, ProvidedMod, ReplayDataSet } from "../contract";

const HASH = /^[0-9a-f]{16}$/;

/** What a page's `ready` says of the mods it keeps (scm-sim's `modFiles`): every hash a kept mod answers to, and the one it plays. */
export interface PageMods { kept: string[]; plays: string | null }

/** A ready's `mods`, read: null when it says none (a page from before `modFiles`). */
export function pageModsOf(v: unknown): PageMods | null {
  const m = v as { kept?: unknown; plays?: unknown } | null | undefined;
  if (!m || typeof m !== "object" || !Array.isArray(m.kept)) return null;
  return { kept: m.kept.filter((h): h is string => typeof h === "string" && HASH.test(h)), plays: typeof m.plays === "string" && HASH.test(m.plays) ? m.plays : null };
}

/** Whether a page that said `mods` keeps the mod of `hash` (it answers to it, or plays it). */
export const pageKeeps = (mods: PageMods | null, hash: string): boolean => !!mods && (mods.kept.includes(hash) || mods.plays === hash);

/** The reasons a page gives beside its sentence (scm-sim's `EngineReason`). */
export type EngineReason = "mod-missing" | "mod-terrain" | "remastered-terrain";
const REASONS: readonly string[] = ["mod-missing", "mod-terrain", "remastered-terrain"];

/** An `Error` worded by the page, with the page's `reason` (and the mod's `hash` for "mod-missing") when it said one. */
export function pageError(m: { message?: unknown; reason?: unknown; hash?: unknown }): Error & { reason?: EngineReason; hash?: string } {
  const e = new Error(String(m.message ?? "")) as Error & { reason?: EngineReason; hash?: string };
  if (typeof m.reason === "string" && REASONS.includes(m.reason)) e.reason = m.reason as EngineReason;
  if (e.reason && typeof m.hash === "string" && HASH.test(m.hash)) e.hash = m.hash;
  return e;
}

/**
 * A mod's file's path as a page is handed it in the game's paths (0.21.0): forward slashes, a game file's in lower case.
 * The mod's code keeps its own names — a module under `plugins/` or `firegraft/`, a program at the top that carries the
 * mod's plugins (the Mod Editor hands a patcher exe so, to keep its loader's order) — as a dropped folder gives them: the
 * page names the modules, and the mod after its program, by them.
 */
export function pagePath(path: string): string {
  const p = path.replace(/\\/g, "/");
  return !p.includes("/") || /^(plugins|firegraft)\/[^/]+\.(qdp|bwl|dll|fgp|fgd)$/i.test(p) ? p : p.toLowerCase();
}

/** Files as a page takes them: `File`s under the game's paths, forward slashes. */
function asPageFiles(files: readonly (ModSourceFile | LiveFile)[]): ModSourceFile[] {
  return files.flatMap((f) => {
    if (!f || typeof f.path !== "string" || !f.path) return [];
    const path = f.path.replace(/\\/g, "/");
    if ("file" in f && typeof File !== "undefined" && f.file instanceof File) return [{ path, file: f.file }];
    if ("bytes" in f && f.bytes instanceof Uint8Array && typeof File !== "undefined") return [{ path: pagePath(path), file: new File([f.bytes as Uint8Array<ArrayBuffer>], path.split("/").pop() || "file") }];
    return [];
  });
}

export class ModSources {
  /** Registered mods by hash; the one registered last is asked first. */
  private readonly provided = new Map<string, ProvidedMod[]>();
  /** Hashes a page has said it keeps, or that a page kept for us: every page of the site finds them. */
  private readonly kept = new Set<string>();
  /** A page keeping a hash now: the promise settles when it is done (kept or not). */
  private readonly keeping = new Map<string, Promise<void>>();
  /** Who hears how far a page is with keeping a hash (another page's request waiting for it). */
  private readonly hearing = new Map<string, Set<(message: string) => void>>();

  /** A mod's files, found by its hash from now until disposed. */
  provide(hash: string, mod: ProvidedMod): Disposable {
    if (!HASH.test(hash) || !mod || typeof mod.files !== "function") return { dispose: () => {} };
    const list = this.provided.get(hash) ?? [];
    list.push(mod);
    this.provided.set(hash, list);
    return {
      dispose: () => {
        const now = this.provided.get(hash);
        if (!now) return;
        const i = now.indexOf(mod);
        if (i >= 0) now.splice(i, 1);
        if (!now.length) this.provided.delete(hash);
      },
    };
  }

  /** The mod registered for `hash` last, or null. */
  registered(hash: string): ProvidedMod | null { return this.provided.get(hash)?.at(-1) ?? null; }

  /** Whether files can be found for `set`: its own, or a registered mod's. */
  has(set: ReplayDataSet | null | undefined): boolean {
    if (!set) return false;
    const own = set.files;
    if (typeof own === "function" || (Array.isArray(own) && own.length)) return true;
    return HASH.test(set.hash) && this.provided.has(set.hash);
  }

  /** The files for `set`: the caller's own first (a list, or a source asked now), else the registered mod's. Null for none. */
  async files(set: ReplayDataSet | null | undefined): Promise<ModSourceFile[] | null> {
    if (!set) return null;
    const own = set.files;
    if (typeof own === "function") { const f = asPageFiles(await own()); return f.length ? f : null; }
    if (Array.isArray(own) && own.length) { const f = asPageFiles(own); return f.length ? f : null; }
    const mod = HASH.test(set.hash) ? this.registered(set.hash) : null;
    if (!mod) return null;
    const f = asPageFiles(await mod.files());
    return f.length ? f : null;
  }

  /** What a page said it keeps. */
  note(mods: PageMods | null): void { if (mods) for (const h of mods.kept) this.kept.add(h); }
  /** A page kept `hash` (its answer came after the files went). */
  noteKept(hash: string): void { if (HASH.test(hash)) this.kept.add(hash); }
  /** Whether a page of the site has said it keeps `hash`. */
  isKept(hash: string): boolean { return this.kept.has(hash); }

  /** Waits while another page keeps `hash`. */
  async settled(hash: string): Promise<void> { await this.keeping.get(hash)?.catch(() => {}); }

  /**
   * `run` as the one keeping of `hash` at a time: it sends the files and resolves once the page kept them (or could
   * not). A second keeping of the same hash meanwhile waits for the first and is not run: `null` comes back, and the
   * caller goes without files. `run` is handed `kept`, to call once the page has kept the mod when its own work goes
   * on after that (an analysis plays the whole replay next): whoever waits for the keeping goes on from then, not
   * from the end of `run`.
   */
  async keepOnce<T>(hash: string, run: (kept: () => void) => Promise<T>): Promise<T | null> {
    const busy = this.keeping.get(hash);
    if (busy) { await busy.catch(() => {}); return null; }
    let kept!: () => void;
    const early = new Promise<void>((resolve) => { kept = resolve; });
    const going = run(kept);
    const done = Promise.race([early, going.then(() => {}, () => {})]);
    this.keeping.set(hash, done);
    void done.then(() => { if (this.keeping.get(hash) === done) this.keeping.delete(hash); });
    return going;
  }

  /** A page keeping `hash` said how far it is, in words: told to whoever waits for that keeping. */
  say(hash: string, message: string): void { for (const l of [...(this.hearing.get(hash) ?? [])]) l(message); }

  /** Hears how far a page keeping `hash` is, until disposed. */
  hear(hash: string, listener: (message: string) => void): Disposable {
    const set = this.hearing.get(hash) ?? new Set();
    set.add(listener);
    this.hearing.set(hash, set);
    return { dispose: () => { set.delete(listener); if (!set.size && this.hearing.get(hash) === set) this.hearing.delete(hash); } };
  }

  /** Marks `hash` as being kept by a page until `done` settles (a page that keeps across a load of its own). */
  markKeeping(hash: string, done: Promise<unknown>): void {
    const settled = done.then(() => {}, () => {});
    this.keeping.set(hash, settled);
    void settled.then(() => { if (this.keeping.get(hash) === settled) this.keeping.delete(hash); });
  }
}
