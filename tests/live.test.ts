import { describe, expect, it } from "vitest";
import { LiveLink, readAnswer, readState } from "../src/live";

const WORDS = { noTab: "no tab", noAnswer: "no answer" };

/** A stand-in for the play page's tab: what it was sent, and whether there is a tab at all. */
function fakeTab(open = true) {
  const sent: Record<string, unknown>[] = [];
  const tab = { open, sent };
  const link = new LiveLink((m) => { if (!tab.open) return false; sent.push(m); return true; }, WORDS);
  return { tab, link };
}

describe("live edit: the conversation with the play page's tab", () => {
  it("sends a patch with its fields and files as Files, and resolves with the page's answer for that patch", async () => {
    const { tab, link } = fakeTab();
    const answer = link.patch([{ table: "units", id: 0, field: "hit_points", value: 50 * 256 }], [{ path: "unit/terran/marine.grp", bytes: new Uint8Array([1, 2, 3]) }]);
    const sent = tab.sent[0] as { type: string; id: string; fields: unknown[]; files: { path: string; file: File }[] };
    expect(sent).toMatchObject({ type: "scmjs.play.patch", fields: [{ table: "units", id: 0, field: "hit_points", value: 12800 }] });
    expect(sent.files[0].path).toBe("unit/terran/marine.grp");
    expect(sent.files[0].file).toBeInstanceOf(File);
    expect(new Uint8Array(await sent.files[0].file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    // Another patch's answer, and something that is not an answer, are not this one's.
    expect(link.heard({ type: "scmjs.play.patched", id: "someone-else", applied: [], deferred: [], errors: [] })).toBe(true);
    expect(link.heard({ type: "scmjs.play.frame", frame: 3 })).toBe(false);
    link.heard({ type: "scmjs.play.patched", id: sent.id, applied: [{ table: "units", id: 0, field: "hit_points", value: 12800, was: 10240, message: "units 0 hit_points: 10240 → 12800" }], deferred: [], errors: [], frame: 41 });
    expect(await answer).toEqual({ applied: [{ table: "units", id: 0, field: "hit_points", value: 12800, was: 10240, message: "units 0 hit_points: 10240 → 12800" }], deferred: [], errors: [], frame: 41 });
  });

  it("says whether a game alone is running, and hears the page say so unasked", async () => {
    const { tab, link } = fakeTab();
    const heard: (boolean | null)[] = [];
    link.onState((s) => heard.push(s ? s.alone : null));
    const asking = link.playing();
    const q = tab.sent[0] as { id: string; what: string };
    expect(q).toMatchObject({ type: "scmjs.play.ask", what: "state" });
    link.heard({ type: "scmjs.play.state", id: q.id, running: true, alone: true, frame: 120, mod: { hash: "d897bfbe5fc3a3e2", name: "Live Test Mod" }, waiting: [] });
    expect(await asking).toBe(true);
    // A game between people started: the page says so by itself.
    link.heard({ type: "scmjs.play.state", running: true, alone: false, frame: 0, mod: null, waiting: [] });
    expect(link.last?.alone).toBe(false);
    link.gone();
    expect(heard).toEqual([true, false, null]);
  });

  it("no tab: playing is false and a patch is refused in words; a page that never answers times out", async () => {
    const none = fakeTab(false);
    expect(await none.link.playing()).toBe(false);
    await expect(none.link.patch([])).rejects.toThrow("no tab");
    const { link } = fakeTab();
    const waiting = link.grafts();
    link.gone();
    await expect(waiting).rejects.toThrow("no answer");
  });

  it("the game's grafts come back as files; an error from the page is the rejection", async () => {
    const { tab, link } = fakeTab();
    const g = link.grafts();
    const q = tab.sent[0] as { id: string };
    link.heard({ type: "scmjs.play.grafts", id: q.id, files: [{ path: "datreq/buttons.graft", bytes: new Uint8Array(12) }, { path: 3 }], left: [] });
    expect(await g).toEqual({ files: [{ path: "datreq/buttons.graft", bytes: new Uint8Array(12) }], left: [] });
    const bad = link.grafts();
    link.heard({ type: "scmjs.play.grafts", id: (tab.sent[1] as { id: string }).id, error: "No game of the game's own engine is running on the play page." });
    await expect(bad).rejects.toThrow(/No game/);
  });

  it("reads the page's answers defensively", () => {
    expect(readAnswer({ applied: [{ message: "ok" }, { nope: 1 }], deferred: "x", errors: [] })).toEqual({ applied: [{ message: "ok" }], deferred: [], errors: [] });
    expect(readState({ type: "scmjs.play.state" })).toBeNull();
    expect(readState({ running: false, mod: { hash: "ab" } })).toEqual({ running: false, alone: false, frame: 0, mod: { hash: "ab", name: "ab" }, waiting: [] });
  });
});

describe("the play page's tab: a mod's test game, then live edit through the same tab", () => {
  it("hands the mod's files and the map over when the page says ready, and sends patches only to a ready tab", async () => {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const posted: { message: Record<string, unknown>; origin: string }[] = [];
    const tabWindow = { closed: false, focus() {}, postMessage(message: Record<string, unknown>, origin: string) { posted.push({ message, origin }); } };
    const g = globalThis as unknown as { window?: unknown };
    const before = g.window;
    g.window = { addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.push(l), removeEventListener() {}, open: () => tabWindow };
    try {
      const { PlayTab } = await import("../src/play");
      const address = { origin: "https://scmjs.dev", play: "https://scmjs.dev/play/", analyse: "", view: "" };
      const tab = new PlayTab(address, { blocked: "blocked", noMap: "no map", replaced: "replaced" });
      const say = (data: Record<string, unknown>) => { for (const l of listeners) l({ origin: address.origin, source: tabWindow, data } as unknown as MessageEvent); };
      const started = tab.playMod(Promise.resolve({ map: { bytes: new Uint8Array([7]), name: "scene.scx" }, mod: { name: "Live Test Mod", hash: "d897bfbe5fc3a3e2", files: [{ path: "arr\\units.dat", bytes: new Uint8Array([1, 2]) }] } }), { useMapSettings: true, race: 1, computers: [], setup: false } as never);
      await new Promise((r) => setTimeout(r, 0));
      expect(posted).toEqual([]);
      expect(await tab.live.patch([]).catch((e: Error) => e.message)).toBe("No play page is open.");
      say({ type: "scmjs.play.ready" });
      const handed = posted[0].message as { type: string; map: Uint8Array; dataSet: { hash: string; files: { path: string; file: File }[] } };
      expect(handed.type).toBe("scmjs.play");
      expect(handed.map).toEqual(new Uint8Array([7]));
      expect(handed.dataSet.hash).toBe("d897bfbe5fc3a3e2");
      expect(handed.dataSet.files[0].path).toBe("arr/units.dat");
      say({ type: "scmjs.play.started", name: "scene.scx" });
      expect(await started).toBe("started");
      const patched = tab.live.patch([{ table: "weapons", id: 0, field: "damage_amount", value: 16 }]);
      const p = posted[1].message as { type: string; id: string };
      expect(p.type).toBe("scmjs.play.patch");
      say({ type: "scmjs.play.patched", id: p.id, applied: [{ message: "weapons 0 damage_amount: 6 → 16" }], deferred: [], errors: [] });
      expect((await patched).applied[0].message).toMatch(/6 → 16/);
      tab.dispose();
    } finally { g.window = before; }
  });
});
