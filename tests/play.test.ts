import { describe, expect, it } from "vitest";
import { PlayTab, validDataSet, validReplayDataSet } from "../src/play";
import { simAddress } from "../src/address";

describe("the data set a map is played with", () => {
  it("passes the editor's three fields through", () => {
    expect(validDataSet({ id: "my-mod", name: "My Mod", hash: "ab12" })).toEqual({ id: "my-mod", name: "My Mod", hash: "ab12" });
  });
  it("names it by its id and leaves the hash empty when the editor knew none", () => {
    expect(validDataSet({ id: "my-mod" })).toEqual({ id: "my-mod", name: "my-mod", hash: "" });
  });
  it("sends nothing for the game's own data or an editor from before", () => {
    expect(validDataSet(undefined)).toBeNull();
    expect(validDataSet({ name: "No id" })).toBeNull();
  });
});

describe("the mod a replay was played with (playReplay's dataSet)", () => {
  it("takes a hash of 16 hex digits with its name and web address", () => {
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", name: " Cosmonarchy ", url: "https://fraudsclub.com/cosmonarchy-bw/" })).toEqual({ hash: "ac3f86533e4b5a31", name: "Cosmonarchy", url: "https://fraudsclub.com/cosmonarchy-bw/" });
  });
  it("leaves out what is not text, and an address that is not the web's", () => {
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", name: 3, url: "javascript:alert(1)" })).toEqual({ hash: "ac3f86533e4b5a31" });
  });
  it("takes the mod's files without a hash (the page hashes them as a dropped mod)", () => {
    const files = [{ path: "arr\\units.dat", bytes: new Uint8Array(4) }, { path: "", bytes: new Uint8Array(1) }, { path: "x", bytes: "no" }];
    expect(validReplayDataSet({ name: "Mine", files })).toEqual({ hash: "", name: "Mine", files: [files[0]] });
  });
  it("keeps `live` when it is true (0.17.0)", () => {
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", live: true })).toEqual({ hash: "ac3f86533e4b5a31", live: true });
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", live: "yes" })).toEqual({ hash: "ac3f86533e4b5a31" });
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", live: false })).toEqual({ hash: "ac3f86533e4b5a31" });
  });
  it("sends nothing for a hash of another form, or nothing at all", () => {
    expect(validReplayDataSet({ hash: "AC3F86533E4B5A31" })).toBeNull();
    expect(validReplayDataSet({ hash: "ac3f" })).toBeNull();
    expect(validReplayDataSet(undefined)).toBeNull();
    expect(validReplayDataSet(null)).toBeNull();
  });
});

describe("a replay handed to the play page's tab", () => {
  /** A stand-in for the editor's window and the tab it opens: what was opened, where the tab was sent, what it was handed. */
  function fakeWindow() {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const tab = {
      closed: false, sent: [] as Record<string, unknown>[], replaced: [] as string[],
      location: { href: "", replace(to: string) { tab.replaced.push(to); tab.location.href = to; } },
      postMessage(m: Record<string, unknown>) { tab.sent.push(m); },
      focus() {},
    };
    const opened: string[] = [];
    const win = {
      addEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.push(l),
      removeEventListener: () => {},
      open: (url: string) => { opened.push(url); tab.location.href = url; return tab; },
    };
    const ready = (features?: string[]) => { for (const l of listeners) l({ origin: "https://scmjs.dev", source: tab, data: { type: "scmjs.play.ready", ...(features ? { features } : {}) } } as unknown as MessageEvent); };
    return { win, tab, opened, ready };
  }
  const WORDS = { blocked: "blocked", noMap: "no map", replaced: "replaced" };
  const address = simAddress({ origin: "https://scmjs.dev", hostname: "scmjs.dev", pathname: "/editor/" })!;

  it("opens the page with ?lift=live for a mod whose code ran, and hands `live` with the data set (0.17.0)", async () => {
    const f = fakeWindow();
    (globalThis as { window?: unknown }).window = f.win;
    try {
      const tab = new PlayTab(address, WORDS);
      void tab.playReplay({ bytes: new Uint8Array([1]), name: "c.rep", dataSet: { hash: "ac3f86533e4b5a31", name: "Cosmonarchy", live: true } }, { frame: 0 }).catch(() => {});
      expect(f.opened).toEqual(["https://scmjs.dev/play/?lift=live"]);
      f.ready(["replayDoor", "liveSwitch"]);
      expect(f.tab.sent[0]).toMatchObject({ type: "scmjs.play", name: "c.rep", frame: 0, dataSet: { hash: "ac3f86533e4b5a31", name: "Cosmonarchy", live: true } });
      expect(tab.features()).toEqual(["replayDoor", "liveSwitch"]);
      // a replay of the game's own data goes to the same tab as it stands
      void tab.playReplay({ bytes: new Uint8Array([2]), name: "v.rep" }, { frame: 5 }).catch(() => {});
      expect(f.tab.replaced).toEqual([]);
      expect(f.tab.sent[1]).toMatchObject({ name: "v.rep", frame: 5 });
      expect(f.tab.sent[1]).not.toHaveProperty("dataSet");
      tab.dispose();
    } finally { delete (globalThis as { window?: unknown }).window; }
  });

  it("points a tab open without ?lift=live there first, keeping its other parameters, and hands the replay on its ready", async () => {
    const f = fakeWindow();
    (globalThis as { window?: unknown }).window = f.win;
    try {
      const tab = new PlayTab(address, WORDS);
      void tab.playReplay({ bytes: new Uint8Array([1]), name: "v.rep" }, { frame: 0 }).catch(() => {});
      expect(f.opened).toEqual(["https://scmjs.dev/play/"]);
      f.tab.location.href = "https://scmjs.dev/play/?debug";
      f.ready();
      expect(tab.features()).toEqual([]);
      void tab.playReplay({ bytes: new Uint8Array([2]), name: "c.rep", dataSet: { hash: "ac3f86533e4b5a31", live: true } }, { frame: 0 }).catch(() => {});
      expect(f.tab.replaced).toEqual(["https://scmjs.dev/play/?debug=&lift=live"]);
      // (not handed until the page there says ready)
      expect(f.tab.sent.map((m) => m.name)).toEqual(["v.rep"]);
      f.ready(["replayDoor", "liveSwitch"]);
      expect(f.tab.sent.map((m) => m.name)).toEqual(["v.rep", "c.rep"]);
      tab.dispose();
    } finally { delete (globalThis as { window?: unknown }).window; }
  });
});
