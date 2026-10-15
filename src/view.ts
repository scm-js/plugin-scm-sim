/**
 * The play page as a replay viewer inside an element of the editor's (scm-sim `web/viewer.ts`, the page at
 * `/play/?view`): the frame is made in the element given, and the conversation with it is behind `ScmSimView`.
 *
 *   ← `{ type: "scmjs.view.ready", version, files, why? }`       the page, once it has looked for the game's files
 *   → `{ type: "scmjs.view.load", replay, name }`                 ← `loaded {…}` or `error {message}`
 *   → `play {playing}`, `speed {multiplier}`, `seek {frame}`, `camera {x, y}`, `player {slot}`
 *   → `options {fog?, sound?, volume?, remastered?, lighting?}`   ← `looks {…}`
 *   ← `frame {frame, playing, seeking}`, `camera {x, y, width, height, byUser}`, `key {key, code, …}`
 *
 * One load at a time: a load asked for while another is on its way replaces it, and the first is rejected. Nothing
 * here touches the DOM directly: the frame is behind `ViewFrameHost`, so the conversation is tested without one.
 */
import type { Disposable, ScmSimView, ViewCamera, ViewFrame, ViewKey, ViewLooks, ViewOptions, ViewReady, ViewedReplay } from "../contract";

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
}

type Listener<T> = (value: T) => void;

const files = (v: unknown): ViewReady["files"] => (v === "archives" || v === "copy" || v === "server" ? v : null);
const looksOf = (m: Record<string, unknown>): ViewLooks => ({ remastered: m.remastered === true, remasteredOn: m.remasteredOn === true, lighting: m.lighting === true, lightingOn: m.lightingOn === true });

export class ViewBridge implements ScmSimView {
  readonly ready: Promise<ViewReady>;
  private readonly frame: HostedFrame;
  private readonly words: ViewWords;
  private loading: { resolve(r: ViewedReplay): void; reject(e: Error): void } | null = null;
  private readonly looksWaiting: ((l: ViewLooks) => void)[] = [];
  private readonly frames = new Set<Listener<ViewFrame>>();
  private readonly cameras = new Set<Listener<ViewCamera>>();
  private readonly keys = new Set<Listener<ViewKey>>();
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
          });
          return;
        }
        case "scmjs.view.error": {
          const l = this.loading;
          this.loading = null;
          l?.reject(new Error(String(m.message ?? "")));
          return;
        }
        case "scmjs.view.looks": { const l = looksOf(m); for (const w of this.looksWaiting.splice(0)) w(l); return; }
        case "scmjs.view.frame": { const f: ViewFrame = { frame: Number(m.frame) || 0, playing: m.playing === true, seeking: typeof m.seeking === "number" ? m.seeking : null }; for (const l of this.frames) l(f); return; }
        case "scmjs.view.camera": { const c: ViewCamera = { x: Number(m.x) || 0, y: Number(m.y) || 0, width: Number(m.width) || 0, height: Number(m.height) || 0, byUser: m.byUser === true }; for (const l of this.cameras) l(c); return; }
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

  private tell(message: object): void { if (!this.closed) this.frame.post(message); }
  play(playing: boolean): void { this.tell({ type: "scmjs.view.play", playing }); }
  speed(multiplier: number): void { this.tell({ type: "scmjs.view.speed", multiplier }); }
  seek(frame: number): void { this.tell({ type: "scmjs.view.seek", frame: Math.max(0, Math.floor(frame)) }); }
  camera(x: number, y: number): void { this.tell({ type: "scmjs.view.camera", x, y }); }
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

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.loading?.reject(new Error(this.words.closed));
    this.loading = null;
    this.looksWaiting.length = 0;
    this.frames.clear(); this.cameras.clear(); this.keys.clear();
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
