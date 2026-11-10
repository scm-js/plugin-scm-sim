/**
 * A map handed to the site's play page (scm-sim `web/handoff.ts`), which runs it in a
 * tab of its own:
 *
 *   ← `{ type: "scmjs.play.ready", features? }`            the play page, each time it loads (`features`: what it does that a
 *                                                         page from before did not, from scm-sim's R2b: "replayDoor", "liveSwitch")
 *   → `{ type: "scmjs.play", map, name, useMapSettings, race, slot?, computers, setup, dataSet? }`
 *                                                         a whole .scm / .scx file, and how to play it (`src/settings.ts`);
 *                                                         `dataSet` `{ id, name, hash, races? }` when the editor makes the map
 *                                                         with a data set other than the game's own (its Test Map hands
 *                                                         it over), for the page to play it with those files; `races`
 *                                                         (0.20.0) the races the data set adds, passed as given (an
 *                                                         empty list, 0.20.1: none; no field: not said)
 *   ← `{ type: "scmjs.play.started" }` / `{ type: "scmjs.play.shown" }` (on the setup screen) / `{ type: "scmjs.play.error", message }`
 *
 * A replay goes the same way (the replay plugin's Play From Here; a play page from before says "No map came with the
 * request."):
 *   → `{ type: "scmjs.play", replay, name, frame, player?, dataSet? }`  watched from `frame`, through `player`'s eyes, the
 *                                                         page's Watch Replay menu open to play on from there; `dataSet`
 *                                                         `{ hash, name?, url?, files? }` the mod it was played with when
 *                                                         the file does not say (the page reads a replay's own `SCMJ`
 *                                                         tag first), `null` the game's own data; `live` (0.17.0) the mod's
 *                                                         code ran (its plugins, or its FireGraft project's exe edits): the
 *                                                         tab is opened at `/play/?lift=live`, and one open without it is
 *                                                         pointed there, so the page need not load itself again for it
 *
 * "Ready" comes again when the play page starts over (a first visit takes the game's
 * files and reloads), and the map is handed over again each time, for as long as that
 * tab is open. Playing again sends the new map to the same tab. A play page from before the
 * settings plays every map with its own settings and says "started".
 *
 * A mod's files handed over mark the mod as being kept until the tab answers (`ModSources.markKeeping`), so that
 * another request for it waits; a page that says ready again before answering took them with it, and the keeping is
 * over then (0.19.2): the hand-over again would otherwise wait for its own answer, which cannot come.
 */
import type { DataSetRace, LiveFile, LiveTest, ModSourceFile, ReplayDataSet } from "../contract";
import { racesOf } from "./races";
import { playAddress, type SimAddress } from "./address";
import { LiveLink, type LiveWords } from "./live";
import { featuresOf } from "./features";
import { pageError, pageKeeps, pageModsOf, type ModSources, type PageMods } from "./mods";
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
export interface PlayDataSet { id: string; name: string; hash: string; files?: LiveFile[]; /** The races the data set adds (0.20.0), passed as given: an empty list (0.20.1) is none, no field not said. */ races?: DataSetRace[] }

/** A map to play, as the editor's Test Map hands it over. */
export interface PlayMap { bytes: Uint8Array; name: string; dataSet?: PlayDataSet }

export interface PlayWords extends Partial<LiveWords> { blocked: string; noMap: string; replaced: string }

export class PlayTab {
  private tab: Window | null = null;
  /** What the tab is handed each time it says ready: a map and how to play it, or a replay and where to stand in it. */
  private handing: { bytes: Uint8Array | null; name: string; how: PlayHow; dataSet?: PlayDataSet } | { replay: Uint8Array; name: string; frame: number; player?: number; dataSet?: ReplayDataSet | null } | null = null;
  private ready = false;
  /** What the page's last `ready` said it does (`features`; none from a page before scm-sim's R2b). */
  private said: string[] = [];
  /** What the page's last `ready` said of the mods this browser keeps (0.19.0, "modFiles"); null from a page before. */
  private mods: PageMods | null = null;
  /** The answer the tab is waiting to give (resolved by `started`/`shown`, or rejected). */
  private answer: Promise<PlayOutcome> | null = null;
  private waiting: { resolve(outcome: PlayOutcome): void; reject(e: Error): void } | null = null;
  /** Ends the keeping a hand-over with a mod's files marked: the page that took them loaded again (0.19.2). */
  private keepingOver: (() => void) | null = null;
  private readonly address: SimAddress;
  private readonly words: PlayWords;
  private readonly heard = (e: MessageEvent) => {
    if (e.origin !== this.address.origin || !this.tab || e.source !== this.tab) return;
    const m = e.data as { type?: unknown; message?: unknown } | null;
    if (!m || typeof m.type !== "string") return;
    if (this.live.heard(m as Record<string, unknown>)) return;
    // (Ready again is the page loaded again: what it was asked before is not coming.)
    if (m.type === "scmjs.play.ready") { this.live.gone(); this.ready = true; this.said = featuresOf((m as { features?: unknown }).features); this.mods = pageModsOf((m as { mods?: unknown }).mods); this.sources?.note(this.mods); this.keepingOver?.(); this.keepingOver = null; this.hand(); }
    else if (m.type === "scmjs.play.started" || m.type === "scmjs.play.shown") { this.waiting?.resolve(m.type === "scmjs.play.shown" ? "shown" : "started"); this.waiting = null; }
    else if (m.type === "scmjs.play.error") { this.waiting?.reject(pageError(m)); this.waiting = null; }
  };

  /** Live edit with the game in the tab (`src/live.ts`). */
  readonly live: LiveLink;

  /** Where a mod's files come from, and which the site's pages keep (shared with the plugin's other pages; 0.19.0). */
  private readonly sources: ModSources | null;

  constructor(address: SimAddress, words: PlayWords, sources: ModSources | null = null) {
    this.address = address; this.words = words; this.sources = sources;
    this.live = new LiveLink((message) => {
      if (!this.tab || this.tab.closed || !this.ready) return false;
      this.tab.postMessage(message, this.address.origin);
      return true;
    }, { noTab: words.noTab ?? "No play page is open.", noAnswer: words.noAnswer ?? "The play page did not answer." });
    window.addEventListener("message", this.heard);
  }

  /** Whether the play page's tab is open and has said it is ready. */
  isOpen(): boolean { return !!this.tab && !this.tab.closed && this.ready; }
  /** What the tab's page said it does when it was last ready (`features`): none with no tab, or from a page before them. */
  features(): string[] { return this.isOpen() ? [...this.said] : []; }

  private hand() {
    const h = this.handing;
    if (!this.tab || this.tab.closed || !h || !this.ready) return;
    const fetching = this.filesToFetch(h.dataSet);
    if (!fetching) { this.post(h, null); return; }
    // (The mod's files gathered first, only now that the page said it does not keep the mod.)
    const tab = this.tab, answer = this.answer, hash = h.dataSet?.hash ?? "";
    void fetching.then((files) => {
      if (this.handing !== h || this.tab !== tab || !this.ready) return;
      if (files && answer && /^[0-9a-f]{16}$/.test(hash) && this.sources) {
        // (Until the tab answers, or says ready again: a new page, which is handed the files again unless it keeps the mod.)
        this.keepingOver?.();
        const over = new Promise<void>((resolve) => { this.keepingOver = resolve; });
        this.sources.markKeeping(hash, Promise.race([answer, over]));
      }
      this.post(h, files);
    }, (err) => { if (this.handing === h) { this.waiting?.reject(err instanceof Error ? err : new Error(String(err))); this.waiting = null; } });
  }

  /**
   * The mod's files to gather before the hand-over (0.19.0), or null to hand over as before: the caller's own source
   * (a function) is asked whenever the page might keep them; a mod registered by its hash only on a page that says it
   * does not keep the mod ("modFiles"). Files as a list go as they always did.
   */
  private filesToFetch(set: ReplayDataSet | PlayDataSet | null | undefined): Promise<ModSourceFile[] | null> | null {
    if (!set || !this.sources || Array.isArray(set.files)) return null;
    const hash = typeof set.hash === "string" ? set.hash : "";
    const modFiles = this.said.includes("modFiles");
    if (modFiles && (pageKeeps(this.mods, hash) || this.sources.isKept(hash))) return null;
    if (typeof set.files === "function") return this.sources.files(set as ReplayDataSet);
    if (!modFiles || !this.sources.has(set as ReplayDataSet)) return null;
    return this.sources.settled(hash).then(() => (this.sources!.isKept(hash) ? null : this.sources!.files(set as ReplayDataSet)));
  }

  private post(h: NonNullable<PlayTab["handing"]>, files: ModSourceFile[] | null) {
    if (!this.tab || this.tab.closed) return;
    const withFiles = <T extends { files?: unknown }>(d: T) => ({ ...pageDataSet(d), ...(files ? { files } : {}) });
    // (A copy: the bytes stay here for the next time the tab asks.)
    if ("replay" in h) {
      const dataSet = h.dataSet === undefined ? {} : { dataSet: h.dataSet && withFiles(h.dataSet) };
      this.tab.postMessage({ type: "scmjs.play", replay: h.replay.slice(), name: h.name, frame: h.frame, ...(h.player !== undefined ? { player: h.player } : {}), ...dataSet }, this.address.origin);
    } else {
      const dataSet = h.dataSet ? withFiles(h.dataSet) : null;
      this.tab.postMessage({ type: "scmjs.play", ...(h.bytes ? { map: h.bytes.slice() } : {}), name: h.name, ...h.how, ...(dataSet ? { dataSet } : {}) }, this.address.origin);
    }
  }

  /**
   * Opens the tab (now: from the click) or brings it forward; false when the browser would not open one. `live`: the
   * page with `?lift=live` (a replay of a mod whose code ran): a tab open without it is pointed there, its other
   * parameters kept, and says ready again from there.
   */
  private open(live = false): boolean {
    const reuse = this.tab !== null && !this.tab.closed;
    if (!reuse) { this.ready = false; this.tab = window.open(playAddress(this.address.play, live), TAB); }
    else {
      if (live) {
        // (The tab is of this origin: its address can be read. One that cannot be is left as it is: the page loads itself again.)
        let href: string | null = null;
        try { href = this.tab!.location.href; } catch { /* another origin by now */ }
        if (href && href.startsWith(this.address.origin) && new URL(href).searchParams.get("lift") !== "live") { this.ready = false; this.tab!.location.replace(playAddress(href, true)); }
      }
      this.tab!.focus();
    }
    return this.tab !== null;
  }

  private handOver(): Promise<PlayOutcome> {
    this.waiting?.reject(new Error(this.words.replaced));
    const started = new Promise<PlayOutcome>((resolve, reject) => { this.waiting = { resolve, reject }; });
    this.answer = started;
    started.catch(() => {});
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
    this.handing = { bytes: map?.bytes ?? null, name: map?.name ?? mod.name, how: useMapSettings === undefined ? how : { ...how, useMapSettings }, dataSet: { id: mod.name, name: mod.name, hash: mod.hash, files: mod.files, ...racesOf(mod.races) } };
    return this.handOver();
  }

  /**
   * A replay watched on the play page from `frame`, through `player`'s eyes (a replay player's slot), with its Watch
   * Replay menu open to play on from there; `dataSet` the mod it was played with, when the file does not say
   * (`validReplayDataSet`). Call it from a click: the tab is opened first.
   */
  async playReplay(replay: { bytes: Uint8Array; name: string; dataSet?: ReplayDataSet | null }, at: { frame: number; player?: number }): Promise<PlayOutcome> {
    if (!this.open(replay.dataSet?.live === true)) throw new Error(this.words.blocked);
    // (null: the game's own data, said; a data set the page could not use: left out, as from an editor before 0.16.0)
    const valid = replay.dataSet === null ? null : validReplayDataSet(replay.dataSet);
    const dataSet = replay.dataSet === null ? { dataSet: null } : valid ? { dataSet: valid } : {};
    this.handing = { replay: replay.bytes, name: replay.name, frame: Math.max(0, Math.floor(at.frame)), ...(at.player !== undefined ? { player: at.player } : {}), ...dataSet };
    return this.handOver();
  }

  dispose() { window.removeEventListener("message", this.heard); this.waiting = null; this.live.gone(); }
}

/** A data set as the page takes it: its files as `File`s under the game's paths, forward slashes and lower case (a source, a function, is not sent). */
function pageDataSet<T extends { files?: unknown }>(d: T): Omit<T, "files"> & { files?: { path: string; file: File }[] } {
  const { files, ...rest } = d;
  return { ...rest, ...(Array.isArray(files) ? { files: (files as LiveFile[]).map((f) => ({ path: f.path.toLowerCase().replace(/\\/g, "/"), file: new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split(/[\\/]/).pop() || "file") })) } : {}) };
}

/**
 * The mod a replay was played with, as the page is told it (0.16.0): a hash of 16 hex digits, or files to keep; a name
 * and a web address when they are text; `live` when it is true (0.17.0). Null when it names nothing the page could use.
 */
export function validReplayDataSet(set: unknown): ReplayDataSet | null {
  if (!set || typeof set !== "object") return null;
  const { hash, name, url, files, live, races } = set as Record<string, unknown>;
  const good = typeof hash === "string" && /^[0-9a-f]{16}$/.test(hash) ? hash : "";
  const kept = Array.isArray(files) ? (files as { path?: unknown; bytes?: unknown }[]).filter((f): f is LiveFile => !!f && typeof f.path === "string" && !!f.path && f.bytes instanceof Uint8Array) : [];
  // (a source of the files, asked only when the page has not got the mod: 0.19.0)
  const source = typeof files === "function" ? (files as ReplayDataSet["files"]) : undefined;
  if (!good && !kept.length && !source) return null;
  return {
    hash: good,
    ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
    ...(typeof url === "string" && /^https?:\/\/\S+$/i.test(url) ? { url } : {}),
    ...(kept.length ? { files: kept } : source ? { files: source } : {}),
    ...(live === true ? { live: true } : {}),
    ...racesOf(races),
  };
}

/** The data set as the page is told it: the three fields as strings, or nothing (an editor from before it, or the game's own data). */
export function validDataSet(set: unknown): PlayDataSet | null {
  if (!set || typeof set !== "object") return null;
  const { id, name, hash, races } = set as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  return { id, name: typeof name === "string" && name ? name : id, hash: typeof hash === "string" ? hash : "", ...racesOf(races) };
}
