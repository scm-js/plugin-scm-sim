/**
 * A map handed to the site's play page (scm-sim `web/handoff.ts`), which runs it in a
 * tab of its own:
 *
 *   ← `{ type: "scmjs.play.ready" }`                       the play page, each time it loads
 *   → `{ type: "scmjs.play", map, name, useMapSettings, race, slot?, computers, setup, dataSet? }`
 *                                                         a whole .scm / .scx file, and how to play it (`src/settings.ts`);
 *                                                         `dataSet` `{ id, name, hash }` when the editor makes the map
 *                                                         with a data set other than the game's own (its Test Map hands
 *                                                         it over), for the page to play it with those files
 *   ← `{ type: "scmjs.play.started" }` / `{ type: "scmjs.play.shown" }` (on the setup screen) / `{ type: "scmjs.play.error", message }`
 *
 * A replay goes the same way (the replay plugin's Play From Here; a play page from before says "No map came with the
 * request."):
 *   → `{ type: "scmjs.play", replay, name, frame, player? }`  watched from `frame`, through `player`'s eyes, the page's
 *                                                         Watch Replay menu open to play on from there
 *
 * "Ready" comes again when the play page starts over (a first visit takes the game's
 * files and reloads), and the map is handed over again each time, for as long as that
 * tab is open. Playing again sends the new map to the same tab. A play page from before the
 * settings plays every map with its own settings and says "started".
 */
import type { LiveFile, LiveTest } from "../contract";
import type { SimAddress } from "./address";
import { LiveLink, type LiveWords } from "./live";
import type { PlayHow } from "./settings";

/** The window's name: one tab for playing, found again by the next call. (The scmjs.dev plugin's Test Map in Browser uses the same.) */
const TAB = "scmjs-play";

/** `started`: the game is on the page; `shown`: the map is on its setup screen. */
export type PlayOutcome = "started" | "shown";

/**
 * The data set a map was made with (the editor's `TestMapFile.dataSet`): the files the page should play it with. A
 * mod handed over whole (the Mod Editor's test game, `scm-sim.live`) carries its files, which the page keeps as a
 * dropped mod and plays.
 */
export interface PlayDataSet { id: string; name: string; hash: string; files?: LiveFile[] }

/** A map to play, as the editor's Test Map hands it over. */
export interface PlayMap { bytes: Uint8Array; name: string; dataSet?: PlayDataSet }

export interface PlayWords extends Partial<LiveWords> { blocked: string; noMap: string; replaced: string }

export class PlayTab {
  private tab: Window | null = null;
  /** What the tab is handed each time it says ready: a map and how to play it, or a replay and where to stand in it. */
  private handing: { bytes: Uint8Array | null; name: string; how: PlayHow; dataSet?: PlayDataSet } | { replay: Uint8Array; name: string; frame: number; player?: number } | null = null;
  private ready = false;
  private waiting: { resolve(outcome: PlayOutcome): void; reject(e: Error): void } | null = null;
  private readonly address: SimAddress;
  private readonly words: PlayWords;
  private readonly heard = (e: MessageEvent) => {
    if (e.origin !== this.address.origin || !this.tab || e.source !== this.tab) return;
    const m = e.data as { type?: unknown; message?: unknown } | null;
    if (!m || typeof m.type !== "string") return;
    if (this.live.heard(m as Record<string, unknown>)) return;
    // (Ready again is the page loaded again: what it was asked before is not coming.)
    if (m.type === "scmjs.play.ready") { this.live.gone(); this.ready = true; this.hand(); }
    else if (m.type === "scmjs.play.started" || m.type === "scmjs.play.shown") { this.waiting?.resolve(m.type === "scmjs.play.shown" ? "shown" : "started"); this.waiting = null; }
    else if (m.type === "scmjs.play.error") { this.waiting?.reject(new Error(String(m.message ?? ""))); this.waiting = null; }
  };

  /** Live edit with the game in the tab (`src/live.ts`). */
  readonly live: LiveLink;

  constructor(address: SimAddress, words: PlayWords) {
    this.address = address; this.words = words;
    this.live = new LiveLink((message) => {
      if (!this.tab || this.tab.closed || !this.ready) return false;
      this.tab.postMessage(message, this.address.origin);
      return true;
    }, { noTab: words.noTab ?? "No play page is open.", noAnswer: words.noAnswer ?? "The play page did not answer." });
    window.addEventListener("message", this.heard);
  }

  /** Whether the play page's tab is open and has said it is ready. */
  isOpen(): boolean { return !!this.tab && !this.tab.closed && this.ready; }

  private hand() {
    const h = this.handing;
    if (!this.tab || this.tab.closed || !h || !this.ready) return;
    // (A copy: the bytes stay here for the next time the tab asks.)
    if ("replay" in h) this.tab.postMessage({ type: "scmjs.play", replay: h.replay.slice(), name: h.name, frame: h.frame, ...(h.player !== undefined ? { player: h.player } : {}) }, this.address.origin);
    else {
      const d = h.dataSet, dataSet = d ? { ...d, ...(d.files ? { files: d.files.map((f) => ({ path: f.path.toLowerCase().replace(/\\/g, "/"), file: new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split(/[\\/]/).pop() || "file") })) } : {}) } : null;
      this.tab.postMessage({ type: "scmjs.play", ...(h.bytes ? { map: h.bytes.slice() } : {}), name: h.name, ...h.how, ...(dataSet ? { dataSet } : {}) }, this.address.origin);
    }
  }

  /** Opens the tab (now: from the click) or brings it forward; false when the browser would not open one. */
  private open(): boolean {
    const reuse = this.tab !== null && !this.tab.closed;
    if (!reuse) { this.ready = false; this.tab = window.open(this.address.play, TAB); }
    else this.tab!.focus();
    return this.tab !== null;
  }

  private handOver(): Promise<PlayOutcome> {
    this.waiting?.reject(new Error(this.words.replaced));
    const started = new Promise<PlayOutcome>((resolve, reject) => { this.waiting = { resolve, reject }; });
    this.hand();
    return started;
  }

  /** `map`: the bytes, or a promise of them (the tab is opened before anything is awaited: a browser lets a click open a tab, not what follows it later). */
  async play(map: PlayMap | Promise<PlayMap | null>, how: PlayHow): Promise<PlayOutcome> {
    if (!this.open()) throw new Error(this.words.blocked);
    const got = await map;
    if (!got) throw new Error(this.words.noMap);
    const dataSet = validDataSet(got.dataSet);
    this.handing = { bytes: got.bytes, name: got.name, how, ...(dataSet ? { dataSet } : {}) };
    return this.handOver();
  }

  /**
   * A mod and a map (or the mod alone: the page keeps it and shows its Mods dialog) handed to the tab: the page keeps
   * the files as a dropped mod, loads again on it and is handed the map again (`scmjs.play.ready`). The Mod Editor's
   * test game. Call it from a click: the tab is opened first.
   */
  async playMod(test: Promise<LiveTest>, how: PlayHow): Promise<PlayOutcome> {
    if (!this.open()) throw new Error(this.words.blocked);
    const { map, mod, useMapSettings } = await test;
    this.handing = { bytes: map?.bytes ?? null, name: map?.name ?? mod.name, how: useMapSettings === undefined ? how : { ...how, useMapSettings }, dataSet: { id: mod.name, name: mod.name, hash: mod.hash, files: mod.files } };
    return this.handOver();
  }

  /**
   * A replay watched on the play page from `frame`, through `player`'s eyes (a replay player's slot), with its Watch
   * Replay menu open to play on from there. Call it from a click: the tab is opened first.
   */
  async playReplay(replay: { bytes: Uint8Array; name: string }, at: { frame: number; player?: number }): Promise<PlayOutcome> {
    if (!this.open()) throw new Error(this.words.blocked);
    this.handing = { replay: replay.bytes, name: replay.name, frame: Math.max(0, Math.floor(at.frame)), ...(at.player !== undefined ? { player: at.player } : {}) };
    return this.handOver();
  }

  dispose() { window.removeEventListener("message", this.heard); this.waiting = null; this.live.gone(); }
}

/** The data set as the page is told it: the three fields as strings, or nothing (an editor from before it, or the game's own data). */
export function validDataSet(set: unknown): PlayDataSet | null {
  if (!set || typeof set !== "object") return null;
  const { id, name, hash } = set as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  return { id, name: typeof name === "string" && name ? name : id, hash: typeof hash === "string" ? hash : "" };
}
