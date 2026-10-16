/**
 * The conversation with the engine's analysis page (scm-sim `web/analyse.ts`), which the
 * plugin frames out of sight:
 *
 *   ← `{ type: "scmjs.sim.ready", version, files, why? }`            the page, once it has looked for the game's files
 *   → `{ type: "scmjs.sim.analyse", id, replay, name?, options? }`   a whole .rep file's bytes
 *   ← `{ type: "scmjs.sim.progress", id, stage, frame, frames }`
 *   ← `{ type: "scmjs.sim.result", id, timeline }`
 *   ← `{ type: "scmjs.sim.error", id, message }`
 *   → `{ type: "scmjs.sim.cancel", id }`
 *   → `{ type: "scmjs.sim.pathing", id, chk, options? }`            a map's pathing (a page from scm-sim 0.7.0 on,
 *                                                                   whose `ready` says `pathing`)
 *   ← `{ type: "scmjs.sim.progress", id, stage, done, total }`      `stage` "starting" or "walking"
 *   ← `{ type: "scmjs.sim.pathed", id, pathing }`
 *
 * The frame is made on the first call and kept; `status()` loads it afresh, since the
 * page looks for the game's files once, when it loads. Nothing here touches the DOM
 * directly: the frame is behind `FrameHost`, so the conversation is tested without one.
 */
import type { AnalyseOptions, PathingOptions, PathingProgress, PathingResult, ReplayTimeline, ScmSimStatus } from "../contract";

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
}

interface Ready { version: number | null; pathing: number | null; files: ScmSimStatus["files"]; why: string | null }
/** What the page said of a request on its way: its progress message, as it came. */
type Heard = { stage?: unknown; frame?: unknown; frames?: unknown; done?: unknown; total?: unknown };
interface Pending { resolve(v: unknown): void; reject(e: Error): void; progress?(m: Heard): void; done(): void }

export function abortError(): Error {
  const e = new Error("The analysis was stopped.");
  e.name = "AbortError";
  return e;
}

export class Bridge {
  private frame: Frame | null = null;
  private ready: Promise<Ready> | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** The page has been asked for and has not yet said it is ready. */
  private opening = false;
  private readonly url: string;
  private readonly host: FrameHost;
  private readonly words: BridgeWords;
  /** How long the page may take to say it is there. */
  private readonly readyMs: number;

  constructor(url: string, host: FrameHost, words: BridgeWords, readyMs = 30000) {
    this.url = url; this.host = host; this.words = words; this.readyMs = readyMs;
  }

  private open(): Promise<Ready> {
    if (this.ready) return this.ready;
    this.ready = new Promise<Ready>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(this.words.noAnswer)), this.readyMs);
      this.frame = this.host(this.url, (data) => {
        const m = data as Heard & { type?: unknown; id?: unknown; version?: unknown; pathing?: unknown; files?: unknown; why?: unknown; timeline?: unknown; message?: unknown } | null;
        if (!m || typeof m.type !== "string") return;
        if (m.type === "scmjs.sim.ready") {
          clearTimeout(timer);
          const files = m.files === "archives" || m.files === "copy" || m.files === "server" ? m.files : null;
          resolve({ version: typeof m.version === "number" ? m.version : null, pathing: typeof m.pathing === "number" ? m.pathing : null, files, why: typeof m.why === "string" ? m.why : null });
          return;
        }
        const p = typeof m.id === "number" ? this.pending.get(m.id) : undefined;
        if (!p) return;
        if (m.type === "scmjs.sim.progress") p.progress?.(m);
        else if (m.type === "scmjs.sim.result") { p.done(); p.resolve(m.timeline); }
        else if (m.type === "scmjs.sim.pathed") { p.done(); p.resolve((m as { pathing?: unknown }).pathing); }
        else if (m.type === "scmjs.sim.error") { p.done(); p.reject(new Error(String(m.message ?? ""))); }
      });
    });
    this.opening = true;
    const settled = () => { this.opening = false; };
    // A page that never answered is asked again by the next call.
    this.ready.then(settled, () => { settled(); this.close(); });
    return this.ready;
  }

  /** Whether the engine can run a game now. The page is loaded again, so a copy of the game made since is found. */
  async status(): Promise<ScmSimStatus> {
    // (Not while a replay is running or the page is still loading for one.)
    if (this.pending.size === 0 && !this.opening) this.close();
    try {
      const r = await this.open();
      return { available: r.files !== null, files: r.files, reason: r.files ? null : r.why ?? this.words.noFiles, timeline: r.version, pathing: r.pathing };
    } catch (err) {
      return { available: false, files: null, reason: err instanceof Error ? err.message : String(err), timeline: null, pathing: null };
    }
  }

  async analyse(replay: Uint8Array, options: AnalyseOptions = {}): Promise<ReplayTimeline> {
    const progress = options.onProgress && ((m: Heard) => options.onProgress!({ stage: m.stage === "playing" ? "playing" : "starting", frame: Number(m.frame) || 0, frames: Number(m.frames) || 0 }));
    // (A copy: the caller keeps its bytes.)
    return this.ask<ReplayTimeline>(options.signal, progress, (id) => ({ type: "scmjs.sim.analyse", id, replay: replay.slice(), name: options.name, options: { sampleEvery: options.sampleEvery, positionsEvery: options.positionsEvery } }));
  }

  /** A map's pathing: `scenario` is the bare scenario (.chk bytes). */
  async pathing(scenario: Uint8Array, options: PathingOptions = {}): Promise<PathingResult> {
    const { signal, onProgress, ...asked } = options;
    const progress = onProgress && ((m: Heard) => onProgress({ stage: m.stage === "walking" ? "walking" : "starting", done: Number(m.done) || 0, total: Number(m.total) || 0 } satisfies PathingProgress));
    return this.ask<PathingResult>(signal, progress, (id) => ({ type: "scmjs.sim.pathing", id, chk: scenario.slice(), options: asked }), (r) => (r.pathing === null ? this.words.noPathing : null));
  }

  /** One request to the page: `message` with its id, answered by a result, an error, or a cancel when `signal` aborts. */
  private async ask<T>(signal: AbortSignal | undefined, progress: ((m: Heard) => void) | undefined, message: (id: number) => object, refuse?: (r: Ready) => string | null): Promise<T> {
    if (signal?.aborted) throw abortError();
    const r = await this.open();
    if (!r.files) throw new Error(r.why ?? this.words.noFiles);
    const refused = refuse?.(r);
    if (refused) throw new Error(refused);
    if (signal?.aborted) throw abortError();
    const frame = this.frame!, id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const stop = () => { this.pending.delete(id); frame.post({ type: "scmjs.sim.cancel", id }); reject(abortError()); };
      signal?.addEventListener("abort", stop, { once: true });
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress, done: () => { this.pending.delete(id); signal?.removeEventListener("abort", stop); } });
      frame.post(message(id));
    });
  }

  /** The frame is taken away; whatever was running is told it will not be answered. */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
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
