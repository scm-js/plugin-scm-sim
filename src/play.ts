/**
 * A map handed to the site's play page (scm-sim `web/handoff.ts`), which runs it in a
 * tab of its own:
 *
 *   ← `{ type: "scmjs.play.ready" }`                       the play page, each time it loads
 *   → `{ type: "scmjs.play", map, name, useMapSettings }`  a whole .scm / .scx file
 *   ← `{ type: "scmjs.play.started" }` / `{ type: "scmjs.play.error", message }`
 *
 * "Ready" comes again when the play page starts over (a first visit takes the game's
 * files and reloads), and the map is handed over again each time, for as long as that
 * tab is open. Playing again sends the new map to the same tab.
 */
import type { SimAddress } from "./address";

/** The window's name: one tab for playing, found again by the next call. (The scmjs.dev plugin's Test Map in Browser uses the same.) */
const TAB = "scmjs-play";

export interface PlayWords { blocked: string; noMap: string; replaced: string }

export class PlayTab {
  private tab: Window | null = null;
  private map: { bytes: Uint8Array; name: string } | null = null;
  private ready = false;
  private waiting: { resolve(): void; reject(e: Error): void } | null = null;
  private readonly address: SimAddress;
  private readonly words: PlayWords;
  private readonly heard = (e: MessageEvent) => {
    if (e.origin !== this.address.origin || !this.tab || e.source !== this.tab) return;
    const m = e.data as { type?: unknown; message?: unknown } | null;
    if (!m || typeof m.type !== "string") return;
    if (m.type === "scmjs.play.ready") { this.ready = true; this.hand(); }
    else if (m.type === "scmjs.play.started") { this.waiting?.resolve(); this.waiting = null; }
    else if (m.type === "scmjs.play.error") { this.waiting?.reject(new Error(String(m.message ?? ""))); this.waiting = null; }
  };

  constructor(address: SimAddress, words: PlayWords) {
    this.address = address; this.words = words;
    window.addEventListener("message", this.heard);
  }

  private hand() {
    if (!this.tab || this.tab.closed || !this.map || !this.ready) return;
    // (A copy: the bytes stay here for the next time the tab asks.)
    this.tab.postMessage({ type: "scmjs.play", map: this.map.bytes.slice(), name: this.map.name, useMapSettings: true }, this.address.origin);
  }

  /** `map`: the bytes, or a promise of them (the tab is opened before anything is awaited: a browser lets a click open a tab, not what follows it later). */
  async play(map: { bytes: Uint8Array; name: string } | Promise<{ bytes: Uint8Array; name: string } | null>): Promise<void> {
    const reuse = this.tab !== null && !this.tab.closed;
    if (!reuse) { this.ready = false; this.tab = window.open(this.address.play, TAB); }
    if (!this.tab) throw new Error(this.words.blocked);
    const got = await map;
    if (!got) throw new Error(this.words.noMap);
    this.map = got;
    if (reuse) this.tab.focus();
    this.waiting?.reject(new Error(this.words.replaced));
    const started = new Promise<void>((resolve, reject) => { this.waiting = { resolve, reject }; });
    this.hand();
    return started;
  }

  dispose() { window.removeEventListener("message", this.heard); this.waiting = null; }
}
