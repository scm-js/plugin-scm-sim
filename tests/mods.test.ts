import { describe, expect, it } from "vitest";
import type { ReplayTimeline } from "../contract";
import { ModSources, pageError, pageKeeps, pageModsOf } from "../src/mods";
import { ViewBridge, type ViewFrameHost } from "../src/view";
import { Bridge, type FrameHost } from "../src/bridge";
import { PlayTab } from "../src/play";
import { simAddress } from "../src/address";

const HASH = "ac3f86533e4b5a31", OTHER = "7f2810398412bf60";
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const file = (path: string, text = "x") => ({ path, file: new File([text], path.split("/").pop()!) });

describe("where a mod's files come from (0.19.0)", () => {
  it("finds a registered mod by its hash, the last registered first, until it is disposed", async () => {
    const sources = new ModSources();
    let asked = 0;
    const a = sources.provide(HASH, { name: "A", files: async () => { asked++; return [file("arr/units.dat")]; } });
    const b = sources.provide(HASH, { name: "B", files: async () => [file("arr/weapons.dat")] });
    expect(asked).toBe(0);
    expect(sources.registered(HASH)?.name).toBe("B");
    expect(sources.has({ hash: HASH })).toBe(true);
    b.dispose();
    expect((await sources.files({ hash: HASH }))?.map((f) => f.path)).toEqual(["arr/units.dat"]);
    expect(asked).toBe(1);
    a.dispose();
    expect(sources.has({ hash: HASH })).toBe(false);
    expect(await sources.files({ hash: HASH })).toBeNull();
    // (not a hash: nothing registered)
    sources.provide("nope", { files: async () => [] }).dispose();
    expect(sources.registered("nope")).toBeNull();
  });

  it("takes the caller's own files first, a list or a source, and makes Files of bytes", async () => {
    const sources = new ModSources();
    sources.provide(HASH, { files: async () => [file("arr/units.dat")] });
    const own = await sources.files({ hash: HASH, files: [{ path: "ARR\\Weapons.dat", bytes: new Uint8Array([1, 2]) }] });
    expect(own?.map((f) => f.path)).toEqual(["arr/weapons.dat"]);
    expect(own?.[0].file).toBeInstanceOf(File);
    expect(own?.[0].file.size).toBe(2);
    const lazy = await sources.files({ hash: HASH, files: async () => [file("Release/mpq/arr/units.dat")] });
    expect(lazy?.map((f) => f.path)).toEqual(["Release/mpq/arr/units.dat"]);
  });

  it("keeps a hash once: a second keeping waits for the first and is not run", async () => {
    const sources = new ModSources();
    let release!: () => void;
    const first = sources.keepOnce(HASH, () => new Promise<string>((r) => { release = () => r("kept"); }));
    let ran = false;
    const second = sources.keepOnce(HASH, async () => { ran = true; return "again"; });
    await tick();
    release();
    expect(await first).toBe("kept");
    expect(await second).toBeNull();
    expect(ran).toBe(false);
    // (done: the next one runs)
    expect(await sources.keepOnce(HASH, async () => "next")).toBe("next");
  });

  it("reads what a page says it keeps, and the page's reason beside its sentence", () => {
    expect(pageModsOf({ kept: [HASH, "nope", 3], plays: OTHER })).toEqual({ kept: [HASH], plays: OTHER });
    expect(pageModsOf(undefined)).toBeNull();
    expect(pageKeeps({ kept: [], plays: HASH }, HASH)).toBe(true);
    expect(pageKeeps(null, HASH)).toBe(false);
    const e = pageError({ message: "This replay is played with release (ac3f86533e4b5a31), which this browser has not got", reason: "mod-missing", hash: HASH });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/^This replay/);
    expect([e.reason, e.hash]).toEqual(["mod-missing", HASH]);
    expect(pageError({ message: "x", reason: "made-up" }).reason).toBeUndefined();
    expect(pageError({ message: "x" })).not.toHaveProperty("reason");
  });
});

/** A stand-in for the view's page: what it was sent, a way to speak as it, and what it says when it loads. */
function fakeViewer(ready: Record<string, unknown>) {
  const sent: Record<string, unknown>[] = [];
  const page = { sent, say: (_m: object) => {}, at: [] as string[], ready };
  const host: ViewFrameHost = (url, _el, heard) => {
    page.say = heard;
    page.at.push(url);
    queueMicrotask(() => heard(page.ready));
    return { post: (m) => { sent.push(m as Record<string, unknown>); }, go: (to) => { page.at.push(to); queueMicrotask(() => heard(page.ready)); }, remove: () => {} };
  };
  return { page, host };
}
const VIEW_WORDS = { noAnswer: "no answer", noFiles: "no files", replaced: "replaced", closed: "closed", noDebug: "no debug" };
const LOADED = { type: "scmjs.view.loaded", name: "a.rep", frames: 900, players: [], map: { width: 128, height: 128 }, rewinds: false, looks: {} };
const element = {} as HTMLElement;

describe("the game view takes a mod's files (0.19.0)", () => {
  it("hands the registered mod's files to a page that does not keep it, says how far it is, and keeps it once", async () => {
    const { page, host } = fakeViewer({ type: "scmjs.view.ready", version: 1, files: "copy", features: ["replayDoor", "liveSwitch", "modFiles"], mods: { kept: [], plays: null } });
    const sources = new ModSources();
    let gathered = 0;
    sources.provide(HASH, { name: "release", files: async () => { gathered++; return [file("Release/mpq/arr/units.dat")]; } });
    const view = new ViewBridge("https://scmjs.dev/play/?view", element, host, VIEW_WORDS, 30000, sources);
    expect((await view.ready).mods).toEqual({ kept: [], plays: null });
    const heard: string[] = [];
    view.onKeeping((k) => heard.push(`${k.hash}: ${k.message}`));
    const loading = view.load(new Uint8Array([1]), "c.rep", { hash: HASH, name: "release", live: true });
    await tick(); await tick();
    expect(page.at.at(-1)).toBe(`https://scmjs.dev/play/?view&mod=${HASH}&lift=live`);
    const load = page.sent.at(-1)!;
    expect(load).toMatchObject({ type: "scmjs.view.load", name: "c.rep", dataSet: { hash: HASH, name: "release", live: true } });
    expect((load.dataSet as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(["Release/mpq/arr/units.dat"]);
    page.say({ type: "scmjs.view.keeping", hash: HASH, message: "Keeping the mod's files: 10 of 7,755 (1.2 MB)…" });
    expect(heard).toEqual([`${HASH}: Keeping the mod's files: 10 of 7,755 (1.2 MB)…`]);
    // The page keeps them, loads itself again on the mod (ready again, keeping it now) and answers the load.
    page.ready = { ...page.ready, mods: { kept: [HASH], plays: HASH } };
    page.say(page.ready);
    page.say(LOADED);
    expect((await loading).frames).toBe(900);
    // Another replay of the mod: no files gathered or sent again.
    const again = view.load(new Uint8Array([2]), "d.rep", { hash: HASH });
    await tick(); await tick();
    expect(page.sent.at(-1)!.dataSet).toEqual({ hash: HASH });
    page.say(LOADED);
    await again;
    expect(gathered).toBe(1);
  });

  it("sends no files for a mod the page keeps, and gathers none", async () => {
    const { page, host } = fakeViewer({ type: "scmjs.view.ready", version: 1, files: "copy", features: ["modFiles"], mods: { kept: [HASH], plays: null } });
    const sources = new ModSources();
    let gathered = 0;
    sources.provide(HASH, { files: async () => { gathered++; return [file("arr/units.dat")]; } });
    const view = new ViewBridge("u?view", element, host, VIEW_WORDS, 30000, sources);
    void view.load(new Uint8Array([1]), "c.rep", { hash: HASH }).catch(() => {});
    await tick(); await tick();
    expect(page.sent.at(-1)!.dataSet).toEqual({ hash: HASH });
    expect(gathered).toBe(0);
  });

  it("with no files to hand, rejects with the page's reason and hash: never another game", async () => {
    const { page, host } = fakeViewer({ type: "scmjs.view.ready", version: 1, files: "copy", features: ["modFiles"], mods: { kept: [], plays: null } });
    const view = new ViewBridge("u?view", element, host, VIEW_WORDS, 30000, new ModSources());
    const loading = view.load(new Uint8Array([1]), "c.rep", { hash: HASH });
    await tick(); await tick();
    expect(page.sent.at(-1)!.dataSet).toEqual({ hash: HASH });
    page.say({ type: "scmjs.view.error", message: "This replay is played with ac3f86533e4b5a31, which this browser has not got, and the view does not play it with StarCraft's own data in its place.", reason: "mod-missing", hash: HASH });
    await expect(loading).rejects.toMatchObject({ reason: "mod-missing", hash: HASH });
  });

  it("speaks to a page from before as before: no data set in the load, no files", async () => {
    const { page, host } = fakeViewer({ type: "scmjs.view.ready", version: 1, files: "copy", features: ["replayDoor", "liveSwitch"] });
    const sources = new ModSources();
    sources.provide(HASH, { files: async () => [file("arr/units.dat")] });
    const view = new ViewBridge("u?view", element, host, VIEW_WORDS, 30000, sources);
    void view.load(new Uint8Array([1]), "c.rep", { hash: HASH }).catch(() => {});
    await tick(); await tick();
    expect(page.sent.at(-1)).not.toHaveProperty("dataSet");
    expect(page.at.at(-1)).toBe(`u?view&mod=${HASH}`);
  });
});

/** A stand-in for the analysis page. */
function fakeAnalysis(ready: Record<string, unknown>) {
  const sent: { type: string; id?: number; [k: string]: unknown }[] = [];
  const page = { sent, say: (_m: object) => {} };
  const host: FrameHost = (_url, heard) => {
    page.say = heard;
    queueMicrotask(() => heard(ready));
    return { post: (m) => { sent.push(m as typeof sent[number]); }, remove: () => {} };
  };
  return { page, host };
}
const BRIDGE_WORDS = { noAnswer: "no answer", noFiles: "no files", closed: "closed", noPathing: "no pathing", noMeasure: "no measure", noTests: "no tests", noCopies: "no copies", noDebug: "no debug", sessionOver: "session over", noFights: "no fights" };

describe("the analysis takes a mod's files (0.19.0)", () => {
  it("hands the files with the first request, says the page's keeping, and the next goes without them", async () => {
    const { page, host } = fakeAnalysis({ type: "scmjs.sim.ready", version: 1, files: "copy", features: ["modAnalysis", "modFiles"], mods: { kept: [], plays: null } });
    const sources = new ModSources();
    let gathered = 0;
    sources.provide(HASH, { files: async () => { gathered++; return [file("arr/units.dat")]; } });
    const bridge = new Bridge("u", host, BRIDGE_WORDS, 30000, sources);
    const progress: string[] = [];
    const first = bridge.analyse(new Uint8Array([1]), { dataSet: { hash: HASH, live: true }, onProgress: (p) => progress.push(`${p.stage}${p.message ? `: ${p.message}` : ""}`) });
    // (A second request meanwhile waits for the first to have kept the mod.)
    const second = bridge.analyse(new Uint8Array([2]), { dataSet: { hash: HASH } });
    await tick(); await tick(); await tick();
    expect(page.sent.length).toBe(1);
    const asked = page.sent[0] as unknown as { id: number; options: { dataSet: { hash: string; live?: boolean; files?: { path: string }[] } } };
    expect(asked.options.dataSet.files?.map((f) => f.path)).toEqual(["arr/units.dat"]);
    expect(asked.options.dataSet.live).toBe(true);
    page.say({ type: "scmjs.sim.progress", id: asked.id, stage: "keeping", frame: 0, frames: 0, message: "Keeping release…" });
    page.say({ type: "scmjs.sim.result", id: asked.id, timeline: { version: 1, frames: 10 } as ReplayTimeline });
    expect((await first).frames).toBe(10);
    expect(progress).toEqual(["keeping: Keeping release…"]);
    await tick(); await tick();
    const next = page.sent[1] as unknown as { id: number; options: { dataSet: Record<string, unknown> } };
    expect(next.options.dataSet).toEqual({ hash: HASH });
    page.say({ type: "scmjs.sim.result", id: next.id, timeline: { version: 1, frames: 11 } as ReplayTimeline });
    expect((await second).frames).toBe(11);
    expect(gathered).toBe(1);
  });

  it("an older page is asked as before (no files), and an error carries the page's reason", async () => {
    const { page, host } = fakeAnalysis({ type: "scmjs.sim.ready", version: 1, files: "copy", features: ["modAnalysis"] });
    const sources = new ModSources();
    sources.provide(HASH, { files: async () => [file("arr/units.dat")] });
    const bridge = new Bridge("u", host, BRIDGE_WORDS, 30000, sources);
    const run = bridge.analyse(new Uint8Array([1]), { dataSet: { hash: HASH } });
    await tick(); await tick();
    expect((page.sent[0] as unknown as { options: { dataSet: unknown } }).options.dataSet).toEqual({ hash: HASH });
    page.say({ type: "scmjs.sim.error", id: page.sent[0].id, message: "Error: this map is built on terrain that StarCraft has not got", reason: "mod-terrain" });
    await expect(run).rejects.toMatchObject({ reason: "mod-terrain" });
  });
});

describe("Test in Browser finds the open mod's files (0.19.0)", () => {
  it("hands them with the map to a play page that says it does not keep the mod", async () => {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const tab = { closed: false, sent: [] as Record<string, unknown>[], location: { href: "", replace() {} }, postMessage(m: Record<string, unknown>) { tab.sent.push(m); }, focus() {} };
    const win = { addEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.push(l), removeEventListener: () => {}, open: () => tab };
    const ready = (mods: object) => { for (const l of listeners) l({ origin: "https://scmjs.dev", source: tab, data: { type: "scmjs.play.ready", features: ["replayDoor", "liveSwitch", "modFiles"], mods } } as unknown as MessageEvent); };
    (globalThis as { window?: unknown }).window = win;
    try {
      const sources = new ModSources();
      sources.provide(HASH, { files: async () => [file("arr/units.dat")] });
      const address = simAddress({ origin: "https://scmjs.dev", hostname: "scmjs.dev", pathname: "/editor/" })!;
      const play = new PlayTab(address, { blocked: "blocked", noMap: "no map", replaced: "replaced" }, sources);
      void play.play({ bytes: new Uint8Array([1]), name: "m.scx", dataSet: { id: "release", name: "release", hash: HASH } }, { useMapSettings: true, race: 1, computers: [] } as never).catch(() => {});
      await tick();
      ready({ kept: [], plays: null });
      await tick(); await tick();
      const first = tab.sent.at(-1) as { dataSet: { hash: string; files?: { path: string }[] } };
      expect(first.dataSet.hash).toBe(HASH);
      expect(first.dataSet.files?.map((f) => f.path)).toEqual(["arr/units.dat"]);
      // The page kept it and loaded again on it: the map handed over again, without the files.
      ready({ kept: [HASH], plays: HASH });
      await tick();
      expect((tab.sent.at(-1) as { dataSet: Record<string, unknown> }).dataSet).toEqual({ id: "release", name: "release", hash: HASH });
      play.dispose();
    } finally { delete (globalThis as { window?: unknown }).window; }
  });
});
