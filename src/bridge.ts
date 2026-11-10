/**
 * The conversation with the engine's analysis page (scm-sim `web/analyse.ts`), which the
 * plugin frames out of sight:
 *
 *   ← `{ type: "scmjs.sim.ready", version, files, why?, features?, mods? }` the page, once it has looked for the game's files;
 *                                                                   `mods` (0.19.0, "modFiles"): `{ kept, plays }`, the hashes of the
 *                                                                   mods this browser keeps
 *   → `{ type: "scmjs.sim.analyse", id, replay, name?, options? }`   a whole .rep file's bytes; `options.dataSet`
 *                                                                   (0.18.0) the mod it was played with: `{ hash, name?,
 *                                                                   url?, live? }`, a page whose `ready` says "modAnalysis"
 *   ← `{ type: "scmjs.sim.progress", id, stage, frame, frames }`
 *   ← `{ type: "scmjs.sim.result", id, timeline }`                 `timeline.mod`: the mod it played with
 *   ← `{ type: "scmjs.sim.error", id, message, reason?, hash? }`    `reason` (0.19.0): "mod-missing", "mod-terrain",
 *                                                                   "remastered-terrain" (`ScmSimError`)
 *   → `{ type: "scmjs.sim.cancel", id }`
 *   A replay of a mod the page does not keep (0.19.0, "modFiles"): `options.dataSet.files` (`{ path, file }`s) go with
 *   it, and `progress` says `stage: "keeping"` with a `message` while the page keeps them before it plays.
 *   → `{ type: "scmjs.sim.pathing", id, chk, options? }`            a map's pathing (a page from scm-sim 0.7.0 on,
 *                                                                   whose `ready` says `pathing`)
 *   ← `{ type: "scmjs.sim.progress", id, stage, done, total }`      `stage` "starting" or "walking"
 *   ← `{ type: "scmjs.sim.pathed", id, pathing }`
 *   → `{ type: "scmjs.sim.measure", id, chk, options? }`            a map's measures (from scm-sim 0.8.0, whose
 *                                                                   `ready` says `measure`); progress `measuring`
 *   ← `{ type: "scmjs.sim.measured", id, measure }`
 *   → `{ type: "scmjs.sim.test", id, chk, module, payload }`        a script's tests beside the game (a page whose
 *                                                                   `ready` says `tests`)
 *   ← `{ type: "scmjs.sim.tested", id, report }`
 *   → `{ type: "scmjs.sim.test", id, chk, module, payload, players, triggers }` a test of several players, a copy of the
 *                                                                   game each (a page whose `ready` says `copies`)
 *   ← `{ type: "scmjs.sim.tested", id, copies }`
 *   → `{ type: "scmjs.sim.debug", id, chk, module, payload }`       one test recorded for the debugger (a page whose
 *                                                                   `ready` says `debug`); its game stays, a session
 *   ← `{ type: "scmjs.sim.debugged", id, recording }`
 *   → `{ type: "scmjs.sim.picture", id, session, frame }`           the session's game at a frame
 *   ← `{ type: "scmjs.sim.pictured", id, frame, kept }`
 *   → `{ type: "scmjs.sim.cancel", id }`                            with a session's id: the session is over
 *   → `{ type: "scmjs.sim.fights", id, replay, fights, options? }` a replay's fights played again (a page whose
 *                                                                   `ready` says `fights`); progress `playing`
 *   ← `{ type: "scmjs.sim.fought", id, result }`                   `options.dataSet` and `result.mod` as for a replay
 *
 * The frame is made on the first call and kept; `status()` loads it afresh, since the
 * page looks for the game's files once, when it loads. Nothing here touches the DOM
 * directly: the frame is behind `FrameHost`, so the conversation is tested without one.
 *
 * A second `ready` from the same frame is a new document: the page loaded again, and whatever the one before was
 * asked is gone with it (0.19.2). What it says replaces what the one before said; every request still waiting is sent
 * to it again, its progress starting over, and given up when the page has loaded again too often with it waiting
 * (`AGAIN`). A debugger's session lived in the document before, so it is over, as one closed.
 */
import type { FightAsk, FightsOptions, FightsProgress, FightsResult, ScmSimDebugSession, ScmSimPicture, AnalyseOptions, MeasureOptions, MeasureProgress, MeasureResult, PathingOptions, PathingProgress, PathingResult, ReplayDataSet, ReplayTimeline, ScmSimStatus, TestCopiesOptions, TestCopyResult, TestRunOptions } from "../contract";
import { featuresOf } from "./features";
import { pageError, pageKeeps, pageModsOf, type ModSources, type PageMods } from "./mods";

/**
 * The mod a replay was played with, as the analysis page is told it (0.18.0): its hash, name, makers' page and `live`,
 * never its files (the page plays the mod the browser keeps); null for none, a hash that is not 16 hex digits included.
 */
export function analysedDataSet(set: ReplayDataSet | null | undefined): { hash: string; name?: string; url?: string; live?: true } | null {
  if (!set || typeof set.hash !== "string" || !/^[0-9a-f]{16}$/.test(set.hash)) return null;
  return {
    hash: set.hash,
    ...(typeof set.name === "string" && set.name.trim() ? { name: set.name.trim() } : {}),
    ...(typeof set.url === "string" && /^https?:\/\/\S+$/i.test(set.url) ? { url: set.url } : {}),
    ...(set.live === true ? { live: true as const } : {}),
  };
}

export interface Frame {
  post(message: object): void;
  remove(): void;
}
/** Opens the page out of sight; `heard` is given every message that page sends. */
export type FrameHost = (url: string, heard: (data: unknown) => void) => Frame;

/** What the bridge says itself, so that the plugin can put it in the person's language. */
export interface BridgeWords {
  noAnswer: string;
  noFiles: string;
  closed: string;
  /** The page is from before a map's pathing. */
  noPathing: string;
  /** The page is from before a map's measures. */
  noMeasure: string;
  /** The page is from before a script's tests. */
  noTests: string;
  /** The page cannot run copies of the game in step (from before them, or the browser cannot). */
  noCopies: string;
  /** The page is from before the debugger. */
  noDebug: string;
  /** A picture asked of a session that is over. */
  sessionOver: string;
  /** The page is from before fights played again. */
  noFights: string;
  /** The page loaded again too many times with a request waiting (0.19.2). */
  reloading: string;
}

interface Ready { version: number | null; pathing: number | null; measure: number | null; tests: number | null; copies: number | null; debug: number | null; fights: number | null; files: ScmSimStatus["files"]; why: string | null; features: string[]; mods: PageMods | null }
/**
 * What the page said of a request on its way: its progress message, as it came. `again` (0.19.2) is said by the bridge,
 * not the page: the page loaded again and the request goes to it anew; `mods` is what that page keeps.
 */
type Heard = { stage?: unknown; frame?: unknown; frames?: unknown; done?: unknown; total?: unknown; message?: unknown; again?: true; mods?: PageMods | null };
interface Pending {
  resolve(v: unknown): void; reject(e: Error): void; progress?(m: Heard): void; done(): void;
  /** The request's message, built again for a page that loaded again; null for one not sent again (a session's picture). */
  message: ((id: number) => object) | null;
  refuse?(r: Ready): string | null;
  /** How many times it was sent again. */
  again: number;
}

/** How many times a request is sent again to a page that loaded again, before it is given up. */
const AGAIN = 2;

/** Two listeners to the page's progress as one: `first` hears each message before `then`. Either may be absent. */
function both(first: ((m: Heard) => void) | undefined, then: ((m: Heard) => void) | undefined): ((m: Heard) => void) | undefined {
  if (!first || !then) return first ?? then;
  return (m) => { first(m); then(m); };
}

export function abortError(): Error {
  const e = new Error("The analysis was stopped.");
  e.name = "AbortError";
  return e;
}

export class Bridge {
  private frame: Frame | null = null;
  private ready: Promise<Ready> | null = null;
  /** What the page said in its last `ready`: a page that loaded again says it anew. */
  private facts: Ready | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** The page has been asked for and has not yet said it is ready. */
  private opening = false;
  /** The debugger's sessions the page holds a game for: while there are any, the page is not loaded afresh. */
  private readonly sessions = new Set<number>();
  private readonly url: string;
  private readonly host: FrameHost;
  private readonly words: BridgeWords;
  /** How long the page may take to say it is there. */
  private readonly readyMs: number;

  /** Where a mod's files come from, and which the site's pages keep (shared with the plugin's other pages; 0.19.0). */
  private readonly sources: ModSources | null;

  constructor(url: string, host: FrameHost, words: BridgeWords, readyMs = 30000, sources: ModSources | null = null) {
    this.url = url; this.host = host; this.words = words; this.readyMs = readyMs; this.sources = sources;
  }

  private open(): Promise<Ready> {
    if (this.ready) return this.ready;
    let frame: Frame | null = null, loads = 0;
    this.ready = new Promise<Ready>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(this.words.noAnswer)), this.readyMs);
      frame = this.frame = this.host(this.url, (data) => {
        // (A frame taken away is not listened to.)
        if (frame && this.frame !== frame) return;
        const m = data as Heard & { type?: unknown; id?: unknown; version?: unknown; pathing?: unknown; measure?: unknown; tests?: unknown; copies?: unknown; debug?: unknown; fights?: unknown; files?: unknown; why?: unknown; timeline?: unknown; message?: unknown; features?: unknown; mods?: unknown; reason?: unknown; hash?: unknown } | null;
        if (!m || typeof m.type !== "string") return;
        if (m.type === "scmjs.sim.ready") {
          clearTimeout(timer);
          const files = m.files === "archives" || m.files === "copy" || m.files === "server" ? m.files : null;
          const r: Ready = { version: typeof m.version === "number" ? m.version : null, pathing: typeof m.pathing === "number" ? m.pathing : null, measure: typeof m.measure === "number" ? m.measure : null, tests: typeof m.tests === "number" ? m.tests : null, copies: typeof m.copies === "number" ? m.copies : null, debug: typeof m.debug === "number" ? m.debug : null, fights: typeof m.fights === "number" ? m.fights : null, files, why: typeof m.why === "string" ? m.why : null, features: featuresOf(m.features), mods: pageModsOf(m.mods) };
          this.facts = r;
          this.sources?.note(r.mods);
          // (Ready again from the same frame: a new document, which knows nothing of what the one before was asked.)
          if (loads++ === 0) resolve(r);
          else this.loadedAgain(r);
          return;
        }
        const p = typeof m.id === "number" ? this.pending.get(m.id) : undefined;
        if (!p) return;
        if (m.type === "scmjs.sim.progress") p.progress?.(m);
        else if (m.type === "scmjs.sim.result") { p.done(); p.resolve(m.timeline); }
        else if (m.type === "scmjs.sim.pathed") { p.done(); p.resolve((m as { pathing?: unknown }).pathing); }
        else if (m.type === "scmjs.sim.measured") { p.done(); p.resolve((m as { measure?: unknown }).measure); }
        else if (m.type === "scmjs.sim.debugged") { p.done(); p.resolve((m as { recording?: unknown }).recording); }
        else if (m.type === "scmjs.sim.pictured") { p.done(); const k = m as { frame?: unknown; kept?: unknown }; p.resolve({ frame: Number(k.frame) || 0, kept: k.kept }); }
        else if (m.type === "scmjs.sim.tested") { p.done(); const t = m as { report?: unknown; copies?: unknown }; p.resolve(Array.isArray(t.copies) ? t.copies : t.report); }
        else if (m.type === "scmjs.sim.fought") { p.done(); p.resolve((m as { result?: unknown }).result); }
        else if (m.type === "scmjs.sim.error") { p.done(); p.reject(pageError(m)); }
      });
    });
    this.opening = true;
    const settled = () => { this.opening = false; };
    // A page that never answered is asked again by the next call.
    this.ready.then(settled, () => { settled(); this.close(); });
    return this.ready;
  }

  /** What the page said when it last loaded (`ready`): the first ready's answer, or a later one's when it loaded again. */
  private async page(): Promise<Ready> {
    const first = await this.open();
    return this.facts ?? first;
  }

  /**
   * The page said ready again (0.19.2): it loaded again, and what the document before was doing is gone. A debugger's
   * session ends with it, as one closed. Every request waiting goes to the new page again, its progress starting over
   * (`again`), unless it is a picture of a session that is over, the page has loaded again too often with it waiting, or
   * the new page refuses it: those are rejected.
   */
  private loadedAgain(r: Ready): void {
    this.sessions.clear();
    const frame = this.frame;
    if (!frame) return;
    for (const [id, p] of [...this.pending]) {
      const message = p.message;
      const refused = !message ? this.words.sessionOver : ++p.again > AGAIN ? this.words.reloading : !r.files ? r.why ?? this.words.noFiles : p.refuse?.(r) ?? null;
      if (!message || refused) { p.done(); p.reject(new Error(refused ?? this.words.sessionOver)); continue; }
      p.progress?.({ stage: "starting", frame: 0, frames: 0, done: 0, total: 0, again: true, mods: r.mods });
      // (Stopped meanwhile by whoever heard that.)
      if (this.pending.get(id) === p) frame.post(message(id));
    }
  }

  /** Whether the engine can run a game now. The page is loaded again, so a copy of the game made since is found. */
  async status(): Promise<ScmSimStatus> {
    // (Not while a replay is running or the page is still loading for one.)
    if (this.pending.size === 0 && !this.opening && this.sessions.size === 0) this.close();
    try {
      const r = await this.page();
      return { available: r.files !== null, files: r.files, reason: r.files ? null : r.why ?? this.words.noFiles, timeline: r.version, pathing: r.pathing, measure: r.measure, tests: r.tests, copies: r.copies, debug: r.debug, fights: r.fights, features: r.features, ...(r.mods ? { mods: r.mods } : {}) };
    } catch (err) {
      return { available: false, files: null, reason: err instanceof Error ? err.message : String(err), timeline: null, pathing: null, measure: null, tests: null, copies: null, debug: null, fights: null, features: [] };
    }
  }

  async analyse(replay: Uint8Array, options: AnalyseOptions = {}): Promise<ReplayTimeline> {
    const progress = options.onProgress && ((m: Heard) => options.onProgress!({ stage: m.stage === "playing" ? "playing" : m.stage === "keeping" ? "keeping" : "starting", frame: Number(m.frame) || 0, frames: Number(m.frames) || 0, ...(m.stage === "keeping" && typeof m.message === "string" ? { message: m.message } : {}) }));
    return this.withModFiles(options.dataSet, (dataSet, watch) =>
      // (A copy: the caller keeps its bytes.)
      this.ask<ReplayTimeline>(options.signal, both(watch, progress), (id) => ({ type: "scmjs.sim.analyse", id, replay: replay.slice(), name: options.name, options: { sampleEvery: options.sampleEvery, positionsEvery: options.positionsEvery, ...dataSet } })));
  }

  /**
   * A request that names a mod (0.19.0, a page whose `ready` says "modFiles"): its files go with it when the page does
   * not keep the mod and they can be found (`ModSources`), once for the site — a request while another page keeps the
   * same mod waits for that, then goes without them. Otherwise the data set goes as before 0.19.0, without files.
   *
   * The wait is for the keeping, not for the request (0.19.1): the page keeps the mod and then plays the whole replay,
   * minutes for a long one, and the view of the same replay waited all of that for a mod kept in the first one. `send`
   * is handed `watch` for the page's progress: once the page is past keeping (it says another stage after "keeping", or
   * "playing"), the mod counts as kept and whoever waits goes on. What it says while keeping is told to them (`say`).
   *
   * A page that loads again sends the request again (0.19.2), so `send`'s message is built from `dataSet` each time it
   * is sent: the files go again to a page that does not keep the mod (the one before may have been part way through
   * keeping it), and not to one that says it does (the one before kept it, then loaded again), which counts as kept.
   */
  private async withModFiles<T>(set: ReplayDataSet | null | undefined, send: (dataSet: { dataSet?: Record<string, unknown> }, watch?: (m: Heard) => void) => Promise<T>): Promise<T> {
    const said = withDataSet(set);
    const r = said.dataSet && this.sources && set ? await this.page().catch(() => null) : null;
    if (!r || !r.features.includes("modFiles") || !said.dataSet || !this.sources || !set) return send(said);
    const sources = this.sources, hash = said.dataSet.hash;
    await sources.settled(hash);
    if (pageKeeps(r.mods, hash) || sources.isKept(hash) || !sources.has(set)) return send(said);
    const handed = await sources.keepOnce(hash, async (pageKept) => {
      const files = await sources.files(set);
      let keeping = false, past = false;
      const sent: { dataSet: Record<string, unknown> } = { dataSet: { ...said.dataSet, ...(files ? { files } : {}) } };
      const kept = () => {
        if (past) return;
        past = true;
        sources.noteKept(hash);
        pageKept();
      };
      const watch = files ? (m: Heard) => {
        if (m.again) {
          // (A new page: the keeping the one before said is gone with it.)
          keeping = false;
          if (pageKeeps(m.mods ?? null, hash)) { sent.dataSet = { ...said.dataSet }; kept(); }
          return;
        }
        if (past) return;
        if (m.stage === "keeping") { keeping = true; if (typeof m.message === "string") sources.say(hash, m.message); return; }
        // (The page says "starting" before it keeps: alone it tells nothing. After "keeping", or "playing", the mod is kept.)
        if (!keeping && m.stage !== "playing") return;
        kept();
      } : undefined;
      const result = await send(sent, watch);
      if (files) sources.noteKept(hash);
      return { result };
    });
    // (Kept by another request meanwhile: this one goes without files, and the page finds what was kept.)
    if (handed) return handed.result;
    return send(said);
  }

  /** A map's pathing: `scenario` is the bare scenario (.chk bytes). */
  async pathing(scenario: Uint8Array, options: PathingOptions = {}): Promise<PathingResult> {
    const { signal, onProgress, ...asked } = options;
    const progress = onProgress && ((m: Heard) => onProgress({ stage: m.stage === "walking" ? "walking" : "starting", done: Number(m.done) || 0, total: Number(m.total) || 0 } satisfies PathingProgress));
    return this.ask<PathingResult>(signal, progress, (id) => ({ type: "scmjs.sim.pathing", id, chk: scenario.slice(), options: asked }), (r) => (r.pathing === null ? this.words.noPathing : null));
  }

  /** A map's measures: `scenario` is the bare scenario (.chk bytes). */
  async measure(scenario: Uint8Array, options: MeasureOptions = {}): Promise<MeasureResult> {
    const { signal, onProgress, ...asked } = options;
    const progress = onProgress && ((m: Heard) => onProgress({ stage: m.stage === "measuring" ? "measuring" : "starting", done: Number(m.done) || 0, total: Number(m.total) || 0 } satisfies MeasureProgress));
    return this.ask<MeasureResult>(signal, progress, (id) => ({ type: "scmjs.sim.measure", id, chk: scenario.slice(), options: asked }), (r) => (r.measure === null ? this.words.noMeasure : null));
  }

  /** A script's tests beside the game: the scenario as eudplib built it, the module's text and its payload, as they are. */
  async test(scenario: Uint8Array, module: string, payload: unknown, options: TestRunOptions = {}): Promise<unknown> {
    const progress = options.onProgress && (() => options.onProgress!({ stage: "starting" }));
    return this.ask<unknown>(options.signal, progress, (id) => ({ type: "scmjs.sim.test", id, chk: scenario.slice(), module, payload }), (r) => (r.tests === null ? this.words.noTests : null));
  }

  /** A test of several players: a copy of the game each, in step; each copy's answer, in the order of `players`. */
  async testCopies(scenario: Uint8Array, module: string, payload: unknown, options: TestCopiesOptions): Promise<TestCopyResult[]> {
    const progress = options.onProgress && (() => options.onProgress!({ stage: "starting" }));
    return this.ask<TestCopyResult[]>(options.signal, progress, (id) => ({ type: "scmjs.sim.test", id, chk: scenario.slice(), module, payload, players: [...options.players], triggers: options.triggers ?? null }), (r) => (r.copies === null ? this.words.noCopies : null));
  }

  /**
   * One test recorded for the debugger: the page runs it once with everything written down and keeps its game, for
   * pictures of the run's frames until the session is closed. One session at a time: a new one ends the one before.
   */
  async debug(scenario: Uint8Array, module: string, payload: unknown, options: TestRunOptions = {}): Promise<ScmSimDebugSession> {
    const progress = options.onProgress && (() => options.onProgress!({ stage: "starting" }));
    let id = 0;
    const recording = await this.ask<unknown>(options.signal, progress, (n) => { id = n; return { type: "scmjs.sim.debug", id: n, chk: scenario.slice(), module, payload }; }, (r) => (r.debug === null ? this.words.noDebug : null));
    for (const other of this.sessions) this.sessions.delete(other);
    this.sessions.add(id);
    const frame = this.frame;
    const live = () => this.sessions.has(id) && this.frame === frame;
    return {
      recording,
      get closed() { return !live(); },
      picture: async (at: number, o: { signal?: AbortSignal } = {}): Promise<ScmSimPicture> => {
        if (!live()) throw new Error(this.words.sessionOver);
        // (Not sent again to a page that loaded again: it has no such session.)
        return this.ask<ScmSimPicture>(o.signal, undefined, (n) => ({ type: "scmjs.sim.picture", id: n, session: id, frame: at }), undefined, false);
      },
      close: () => {
        if (!this.sessions.delete(id)) return;
        if (this.frame === frame) this.frame?.post({ type: "scmjs.sim.cancel", id });
      },
    };
  }

  /** A replay's fights played again: `replay` is a whole .rep file. */
  async fights(replay: Uint8Array, fights: FightAsk[], options: FightsOptions = {}): Promise<FightsResult> {
    const { signal, onProgress, dataSet, ...asked } = options;
    const progress = onProgress && ((m: Heard) => onProgress({ stage: m.stage === "playing" ? "playing" : "starting", frame: Number(m.frame) || 0, frames: Number(m.frames) || 0 } satisfies FightsProgress));
    return this.withModFiles(dataSet, (d, watch) => this.ask<FightsResult>(signal, both(watch, progress), (id) => ({ type: "scmjs.sim.fights", id, replay: replay.slice(), fights, options: { ...asked, ...d } }), (r) => (r.fights === null ? this.words.noFights : null)));
  }

  /**
   * One request to the page: `message` with its id, answered by a result, an error, or a cancel when `signal` aborts.
   * `message` is called again, with the same id, when the page loads again before answering (unless `sendAgain` is false).
   */
  private async ask<T>(signal: AbortSignal | undefined, progress: ((m: Heard) => void) | undefined, message: (id: number) => object, refuse?: (r: Ready) => string | null, sendAgain = true): Promise<T> {
    if (signal?.aborted) throw abortError();
    const r = await this.page();
    if (!r.files) throw new Error(r.why ?? this.words.noFiles);
    const refused = refuse?.(r);
    if (refused) throw new Error(refused);
    if (signal?.aborted) throw abortError();
    const frame = this.frame!, id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const stop = () => { this.pending.delete(id); frame.post({ type: "scmjs.sim.cancel", id }); reject(abortError()); };
      signal?.addEventListener("abort", stop, { once: true });
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress, done: () => { this.pending.delete(id); signal?.removeEventListener("abort", stop); }, message: sendAgain ? message : null, refuse, again: 0 });
      frame.post(message(id));
    });
  }

  /** The frame is taken away; whatever was running is told it will not be answered. */
  close(): void {
    this.sessions.clear();
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
    this.facts = null;
    for (const p of [...this.pending.values()]) { p.done(); p.reject(new Error(this.words.closed)); }
  }
}

/** The real thing: a hidden frame of the editor's own origin, and that frame's messages alone. */
export function domFrames(origin: string): FrameHost {
  return (url, heard) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "scm-sim";
    const listener = (e: MessageEvent) => { if (e.origin === origin && e.source === frame.contentWindow) heard(e.data); };
    window.addEventListener("message", listener);
    frame.src = url;
    document.body.append(frame);
    return {
      post: (message) => frame.contentWindow?.postMessage(message, origin),
      remove: () => { window.removeEventListener("message", listener); frame.remove(); },
    };
  };
}

/** `{ dataSet }` for a request's options when there is a mod to name, else nothing (the options as before 0.18.0). */
function withDataSet(set: ReplayDataSet | null | undefined): { dataSet?: NonNullable<ReturnType<typeof analysedDataSet>> } {
  const d = analysedDataSet(set);
  return d ? { dataSet: d } : {};
}
