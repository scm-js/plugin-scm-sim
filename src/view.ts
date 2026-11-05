/**
 * The play page as a replay viewer inside an element of the editor's (scm-sim `web/viewer.ts`, the page at
 * `/play/?view`): the frame is made in the element given, and the conversation with it is behind `ScmSimView`.
 *
 *   ← `{ type: "scmjs.view.ready", version, files, why? }`       the page, once it has looked for the game's files
 *   → `{ type: "scmjs.view.load", replay, name }`                 ← `loaded {…}` or `error {message}`
 *   → `play {playing}`, `speed {multiplier}`, `seek {frame}`, `camera {x, y}`, `follow {track}`, `player {slot}`
 *   → `options {fog?, sound?, volume?, music?, duck?, remastered?, lighting?, console?}`   ← `looks {…}`
 *   ← `frame {frame, playing, seeking}`, `camera {x, y, width, height, byUser}`, `key {key, code, …}`
 *   → `debug {map}` (a page whose `ready` says `debug`)          ← `debugged {map}` or `error {message}`
 *   → `show {kept}`                                              ← `shown {frame}`, or `error {message}` (said to `onError`)
 *
 * One load at a time: a load asked for while another is on its way replaces it, and the first is rejected. Nothing
 * here touches the DOM directly: the frame is behind `ViewFrameHost`, so the conversation is tested without one.
 */
import type { Disposable, ScmSimPicture, ScmSimView, ViewCamera, ViewFrame, ViewHover, ViewHoverUnit, ViewKey, ViewLooks, ViewOptions, ViewPointer, ViewReady, ViewTrack, ViewUnits, ViewWheel, ViewedReplay } from "../contract";

export interface HostedFrame {
  post(message: object): void;
  remove(): void;
}
/** Makes the frame inside `element`; `heard` is given every message that frame's page sends. */
export type ViewFrameHost = (url: string, element: HTMLElement, heard: (data: unknown) => void) => HostedFrame;

/** What the view says itself, so the plugin can put it in the person's language. */
export interface ViewWords {
  noAnswer: string;
  noFiles: string;
  replaced: string;
  closed: string;
  /** The page is from before the debugger's pictures. */
  noDebug: string;
}

type Listener<T> = (value: T) => void;

const files = (v: unknown): ViewReady["files"] => (v === "archives" || v === "copy" || v === "server" ? v : null);
const looksOf = (m: Record<string, unknown>): ViewLooks => ({ remastered: m.remastered === true, remasteredOn: m.remasteredOn === true, lighting: m.lighting === true, lightingOn: m.lightingOn === true });

export class ViewBridge implements ScmSimView {
  readonly ready: Promise<ViewReady>;
  private readonly frame: HostedFrame;
  private readonly words: ViewWords;
  private loading: { resolve(r: ViewedReplay): void; reject(e: Error): void } | null = null;
  private debugging: { resolve(r: { map: { width: number; height: number } }): void; reject(e: Error): void } | null = null;
  /** The page's `ready` said it draws a debugged run's pictures. */
  private debugs = false;
  private readonly errors = new Set<Listener<string>>();
  private readonly shown = new Set<Listener<number>>();
  private readonly looksWaiting: ((l: ViewLooks) => void)[] = [];
  private readonly frames = new Set<Listener<ViewFrame>>();
  private readonly cameras = new Set<Listener<ViewCamera>>();
  private readonly keys = new Set<Listener<ViewKey>>();
  private readonly units = new Set<Listener<ViewUnits>>();
  private readonly hovers = new Set<Listener<ViewHover | null>>();
  private readonly wheels = new Set<Listener<ViewWheel>>();
  private readonly pointers = new Set<Listener<ViewPointer | null>>();
  private closed = false;

  constructor(url: string, element: HTMLElement, host: ViewFrameHost, words: ViewWords, readyMs = 30000) {
    this.words = words;
    let answered: (r: ViewReady) => void = () => {};
    this.ready = new Promise<ViewReady>((resolve) => { answered = resolve; });
    const timer = setTimeout(() => answered({ files: null, reason: words.noAnswer }), readyMs);
    this.frame = host(url, element, (data) => {
      const m = data as Record<string, unknown> | null;
      if (!m || typeof m.type !== "string" || !m.type.startsWith("scmjs.view.") || this.closed) return;
      switch (m.type) {
        case "scmjs.view.ready": {
          clearTimeout(timer);
          this.debugs = typeof m.debug === "number";
          const f = files(m.files);
          answered({ files: f, reason: f ? null : typeof m.why === "string" && m.why ? m.why : words.noFiles });
          return;
        }
        case "scmjs.view.loaded": {
          const l = this.loading;
          this.loading = null;
          l?.resolve({
            name: String(m.name ?? ""), frames: Number(m.frames) || 0,
            players: Array.isArray(m.players) ? (m.players as { slot: number; name: string; race: number }[]).map((p) => ({ slot: Number(p.slot), name: String(p.name ?? ""), race: Number(p.race) })) : [],
            map: { width: Number((m.map as { width?: unknown } | undefined)?.width) || 0, height: Number((m.map as { height?: unknown } | undefined)?.height) || 0 },
            rewinds: m.rewinds === true,
            looks: looksOf((m.looks ?? {}) as Record<string, unknown>),
            follows: m.follows === true,
          });
          return;
        }
        case "scmjs.view.error": {
          const message = String(m.message ?? "");
          const l = this.loading ?? this.debugging;
          if (l === this.loading) this.loading = null; else this.debugging = null;
          if (l) l.reject(new Error(message));
          else for (const e of this.errors) e(message);
          return;
        }
        case "scmjs.view.debugged": {
          const d = this.debugging;
          this.debugging = null;
          d?.resolve({ map: { width: Number((m.map as { width?: unknown } | undefined)?.width) || 0, height: Number((m.map as { height?: unknown } | undefined)?.height) || 0 } });
          return;
        }
        case "scmjs.view.shown": { const f = Number(m.frame) || 0; for (const l of this.shown) l(f); return; }
        case "scmjs.view.looks": { const l = looksOf(m); for (const w of this.looksWaiting.splice(0)) w(l); return; }
        case "scmjs.view.frame": { const f: ViewFrame = { frame: Number(m.frame) || 0, playing: m.playing === true, seeking: typeof m.seeking === "number" ? m.seeking : null }; for (const l of this.frames) l(f); return; }
        case "scmjs.view.camera": { const c: ViewCamera = { x: Number(m.x) || 0, y: Number(m.y) || 0, width: Number(m.width) || 0, height: Number(m.height) || 0, byUser: m.byUser === true }; for (const l of this.cameras) l(c); return; }
        case "scmjs.view.units": {
          if (!(m.boxes instanceof Float32Array) || !(m.colours instanceof Uint32Array) || m.boxes.length !== m.colours.length * 4) return;
          const wide = Number(m.wide) || 0;
          // (A fog that is not whole rows of the map is no fog to draw.)
          const fog = m.fog instanceof Uint8Array && wide > 0 && m.fog.length % wide === 0 ? m.fog : null;
          const u: ViewUnits = { frame: Number(m.frame) || 0, boxes: m.boxes, colours: m.colours, fog, wide: fog ? wide : 0 };
          for (const l of this.units) l(u);
          return;
        }
        case "scmjs.view.hover": { const h = hoverOf(m); for (const l of this.hovers) l(h); return; }
        case "scmjs.view.wheel": {
          const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
          const w: ViewWheel = { deltaX: n(m.deltaX), deltaY: n(m.deltaY), deltaMode: n(m.deltaMode), ctrlKey: m.ctrlKey === true, metaKey: m.metaKey === true, shiftKey: m.shiftKey === true, altKey: m.altKey === true, x: n(m.x), y: n(m.y) };
          for (const l of this.wheels) l(w);
          return;
        }
        case "scmjs.view.pointer": {
          const p = m.pointer as { x?: unknown; y?: unknown } | null | undefined;
          const at: ViewPointer | null = p && typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
          for (const l of this.pointers) l(at);
          return;
        }
        case "scmjs.view.key": {
          const k: ViewKey = { key: String(m.key ?? ""), code: String(m.code ?? ""), shiftKey: m.shiftKey === true, ctrlKey: m.ctrlKey === true, altKey: m.altKey === true, metaKey: m.metaKey === true };
          for (const l of this.keys) l(k);
          return;
        }
      }
    });
  }

  async load(replay: Uint8Array, name = "replay.rep"): Promise<ViewedReplay> {
    const r = await this.ready;
    if (this.closed) throw new Error(this.words.closed);
    if (!r.files) throw new Error(r.reason ?? this.words.noFiles);
    this.loading?.reject(new Error(this.words.replaced));
    return new Promise<ViewedReplay>((resolve, reject) => {
      this.loading = { resolve, reject };
      // (A copy: the caller keeps its bytes.)
      this.frame.post({ type: "scmjs.view.load", replay: replay.slice(), name });
    });
  }

  /**
   * A debugged run's built map (TrigScript 4, A5), started as the engine's page started it for the record: the view
   * then draws the run's pictures (`show`) and never plays. Rejects on a page from before it, or a copy of the game
   * that may only watch.
   */
  async debug(map: Uint8Array): Promise<{ map: { width: number; height: number } }> {
    const r = await this.ready;
    if (this.closed) throw new Error(this.words.closed);
    if (!r.files) throw new Error(r.reason ?? this.words.noFiles);
    if (!this.debugs) throw new Error(this.words.noDebug);
    this.loading?.reject(new Error(this.words.replaced));
    this.loading = null;
    this.debugging?.reject(new Error(this.words.replaced));
    return new Promise((resolve, reject) => {
      this.debugging = { resolve, reject };
      this.frame.post({ type: "scmjs.view.debug", map: map.slice() });
    });
  }
  /** Draws a picture of the debugged run (`ScmSimDebugSession.picture`); `onShown` hears when it is up. */
  show(picture: ScmSimPicture): void { this.tell({ type: "scmjs.view.show", kept: picture.kept }); }
  onShown(listener: Listener<number>): Disposable { return this.listen(this.shown, listener); }
  /** What went wrong with no request waiting on it (a picture that could not be drawn). */
  onError(listener: Listener<string>): Disposable { return this.listen(this.errors, listener); }

  private tell(message: object): void { if (!this.closed) this.frame.post(message); }
  play(playing: boolean): void { this.tell({ type: "scmjs.view.play", playing }); }
  speed(multiplier: number): void { this.tell({ type: "scmjs.view.speed", multiplier }); }
  seek(frame: number): void { this.tell({ type: "scmjs.view.seek", frame: Math.max(0, Math.floor(frame)) }); }
  camera(x: number, y: number, height?: number): void { this.tell(height !== undefined && height > 0 ? { type: "scmjs.view.camera", x, y, height } : { type: "scmjs.view.camera", x, y }); }
  // (Copies: the caller keeps its track.)
  follow(track: ViewTrack | null): void { this.tell({ type: "scmjs.view.follow", track: track && { every: track.every, x: track.x.slice(), y: track.y.slice(), cut: track.cut.slice() } }); }
  player(slot: number): void { this.tell({ type: "scmjs.view.player", slot }); }
  options(o: ViewOptions): Promise<ViewLooks> {
    if (this.closed) return Promise.reject(new Error(this.words.closed));
    return new Promise<ViewLooks>((resolve) => {
      this.looksWaiting.push(resolve);
      this.frame.post({ type: "scmjs.view.options", ...o });
    });
  }

  private listen<T>(set: Set<Listener<T>>, listener: Listener<T>): Disposable {
    set.add(listener);
    return { dispose: () => { set.delete(listener); } };
  }
  onFrame(listener: Listener<ViewFrame>): Disposable { return this.listen(this.frames, listener); }
  onCamera(listener: Listener<ViewCamera>): Disposable { return this.listen(this.cameras, listener); }
  onKey(listener: Listener<ViewKey>): Disposable { return this.listen(this.keys, listener); }
  onUnits(listener: Listener<ViewUnits>): Disposable { return this.listen(this.units, listener); }
  onHover(listener: Listener<ViewHover | null>): Disposable { return this.listen(this.hovers, listener); }
  onWheel(listener: Listener<ViewWheel>): Disposable { return this.listen(this.wheels, listener); }
  onPointer(listener: Listener<ViewPointer | null>): Disposable { return this.listen(this.pointers, listener); }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.loading?.reject(new Error(this.words.closed));
    this.loading = null;
    this.debugging?.reject(new Error(this.words.closed));
    this.debugging = null;
    this.looksWaiting.length = 0;
    this.errors.clear(); this.shown.clear();
    this.frames.clear(); this.cameras.clear(); this.keys.clear(); this.units.clear(); this.hovers.clear(); this.wheels.clear(); this.pointers.clear();
    this.frame.remove();
  }
}

/** The real thing: a frame of the editor's own origin filling `element`, and that frame's messages alone. */
export function domViewFrames(origin: string): ViewFrameHost {
  return (url, element, heard) => {
    const frame = document.createElement("iframe");
    frame.title = "StarCraft";
    frame.style.cssText = "border: 0; display: block; width: 100%; height: 100%";
    // (Its keys come back as messages; it may take the keyboard and the pointer, and go fullscreen.)
    frame.allow = "fullscreen; autoplay";
    const listener = (e: MessageEvent) => { if (e.origin === origin && e.source === frame.contentWindow) heard(e.data); };
    window.addEventListener("message", listener);
    frame.src = url;
    element.append(frame);
    return {
      post: (message) => frame.contentWindow?.postMessage(message, origin),
      remove: () => { window.removeEventListener("message", listener); frame.remove(); },
    };
  };
}

/** A key the view handed back, pressed again on the editor's window: its hotkeys and the plugins' act as if it were pressed there. */
export function pressOnWindow(k: ViewKey): void {
  if (typeof window === "undefined" || typeof KeyboardEvent === "undefined") return;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: k.key, code: k.code, shiftKey: k.shiftKey, ctrlKey: k.ctrlKey, altKey: k.altKey, metaKey: k.metaKey, bubbles: true, cancelable: true }));
}

const WORKS = new Set(["construction", "train", "research", "upgrade", "morph", "addon", "nuke"]);

/** A hover message as the contract has it: null for nothing under the pointer, or a message that is not one. */
function hoverOf(m: Record<string, unknown>): ViewHover | null {
  const u = m.unit as Record<string, unknown> | null | undefined;
  if (!u || typeof u !== "object") return null;
  const n = (v: unknown, or = -1) => (typeof v === "number" && Number.isFinite(v) ? v : or);
  if (n(u.type) < 0) return null;
  const unit: ViewHoverUnit = {
    id: n(u.id), type: n(u.type), owner: n(u.owner, 0),
    hp: n(u.hp, 0), hpMax: n(u.hpMax, 0), invincible: u.invincible === true,
    shields: n(u.shields), shieldsMax: n(u.shieldsMax, 0), energy: n(u.energy), energyMax: n(u.energyMax, 0),
    completed: u.completed !== false,
    work: typeof u.work === "string" && WORKS.has(u.work) ? (u.work as ViewHoverUnit["work"]) : null, workId: n(u.workId),
    progress: n(u.progress), queue: Array.isArray(u.queue) ? u.queue.filter((t): t is number => typeof t === "number" && t >= 0) : [],
    resources: n(u.resources),
  };
  return { unit, x: n(m.x, 0), y: n(m.y, 0) };
}
