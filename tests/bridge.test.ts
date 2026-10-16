import { describe, expect, it } from "vitest";
import type { MeasureResult, PathingResult, ReplayTimeline } from "../contract";
import { Bridge, type FrameHost } from "../src/bridge";

const WORDS = { noAnswer: "no answer", noFiles: "no files", closed: "closed", noPathing: "no pathing", noMeasure: "no measure", noTests: "no tests" };
const timeline = (frames: number) => ({ version: 1, frames } as ReplayTimeline);

/** A stand-in for the engine's page: what it was sent, and a way to speak as it. */
function fakePage(ready: object | null = { type: "scmjs.sim.ready", version: 1, files: "copy" }) {
  const sent: { type: string; id?: number; [k: string]: unknown }[] = [];
  const page = { sent, opened: 0, removed: 0, say: (_m: object) => {} };
  const host: FrameHost = (_url, heard) => {
    page.opened++;
    page.say = heard;
    if (ready) queueMicrotask(() => heard(ready));
    return { post: (m) => { sent.push(m as typeof sent[number]); }, remove: () => { page.removed++; } };
  };
  return { page, host };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("the conversation with the engine's page", () => {
  it("says whether a game can be run, from what the page says of the game's files", async () => {
    const yes = fakePage();
    expect(await new Bridge("u", yes.host, WORDS).status()).toEqual({ available: true, files: "copy", reason: null, timeline: 1, pathing: null, measure: null, tests: null });
    const no = fakePage({ type: "scmjs.sim.ready", version: 1, files: null, why: "install it" });
    expect(await new Bridge("u", no.host, WORDS).status()).toEqual({ available: false, files: null, reason: "install it", timeline: 1, pathing: null, measure: null, tests: null });
    const newer = fakePage({ type: "scmjs.sim.ready", version: 4, pathing: 1, files: "copy" });
    expect(await new Bridge("u", newer.host, WORDS).status()).toMatchObject({ available: true, timeline: 4, pathing: 1 });
  });

  it("gives up on a page that never answers, and asks again the next time", async () => {
    const { page, host } = fakePage(null);
    const bridge = new Bridge("u", host, WORDS, 5);
    expect(await bridge.status()).toMatchObject({ available: false, reason: "no answer" });
    await bridge.status();
    expect(page.opened).toBe(2);
    expect(page.removed).toBeGreaterThanOrEqual(1);
  });

  it("hands a replay over and resolves with the page's timeline, passing progress on", async () => {
    const { page, host } = fakePage();
    const bridge = new Bridge("u", host, WORDS);
    const seen: string[] = [];
    const replay = new Uint8Array([1, 2, 3]);
    const got = bridge.analyse(replay, { name: "a.rep", sampleEvery: 24, onProgress: (p) => seen.push(`${p.stage} ${p.frame}/${p.frames}`) });
    await tick();
    const asked = page.sent[0];
    expect(asked).toMatchObject({ type: "scmjs.sim.analyse", name: "a.rep", options: { sampleEvery: 24 } });
    // A copy went over: the caller's bytes are its own still.
    expect(asked.replay).not.toBe(replay);
    expect([...(asked.replay as Uint8Array)]).toEqual([1, 2, 3]);
    page.say({ type: "scmjs.sim.progress", id: asked.id, stage: "starting", frame: 0, frames: 0 });
    page.say({ type: "scmjs.sim.progress", id: asked.id, stage: "playing", frame: 500, frames: 900 });
    page.say({ type: "scmjs.sim.result", id: asked.id, timeline: timeline(900) });
    expect((await got).frames).toBe(900);
    expect(seen).toEqual(["starting 0/0", "playing 500/900"]);
  });

  it("keeps two requests apart by their numbers and uses one frame for both", async () => {
    const { page, host } = fakePage();
    const bridge = new Bridge("u", host, WORDS);
    const a = bridge.analyse(new Uint8Array(1)), b = bridge.analyse(new Uint8Array(1));
    await tick();
    expect(page.opened).toBe(1);
    const [first, second] = page.sent;
    expect(first.id).not.toBe(second.id);
    page.say({ type: "scmjs.sim.result", id: second.id, timeline: timeline(2) });
    page.say({ type: "scmjs.sim.error", id: first.id, message: "not a replay" });
    expect((await b).frames).toBe(2);
    await expect(a).rejects.toThrow("not a replay");
  });

  it("refuses a replay when the browser has no copy of the game", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 1, files: null });
    await expect(new Bridge("u", host, WORDS).analyse(new Uint8Array(1))).rejects.toThrow("no files");
    expect(page.sent).toEqual([]);
  });

  it("stops a replay when asked, telling the page", async () => {
    const { page, host } = fakePage();
    const bridge = new Bridge("u", host, WORDS);
    const stop = new AbortController();
    const got = bridge.analyse(new Uint8Array(1), { signal: stop.signal });
    await tick();
    stop.abort();
    await expect(got).rejects.toMatchObject({ name: "AbortError" });
    expect(page.sent.map((m) => m.type)).toEqual(["scmjs.sim.analyse", "scmjs.sim.cancel"]);
    expect(page.sent[1].id).toBe(page.sent[0].id);
    // What the page says of it afterwards is nobody's.
    page.say({ type: "scmjs.sim.result", id: page.sent[0].id, timeline: timeline(1) });
    await expect(bridge.analyse(new Uint8Array(1), { signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("hands a map's scenario over for its pathing and resolves with the page's answer, passing progress on", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 4, pathing: 1, files: "copy" });
    const bridge = new Bridge("u", host, WORDS);
    const seen: string[] = [];
    const chk = new Uint8Array([9, 8, 7]);
    const got = bridge.pathing(chk, { units: [66], directed: true, onProgress: (p) => seen.push(`${p.stage} ${p.done}/${p.total}`) });
    await tick();
    const asked = page.sent[0];
    expect(asked).toMatchObject({ type: "scmjs.sim.pathing", options: { units: [66], directed: true } });
    // The callbacks stay here; a copy of the bytes goes over.
    expect(asked.options).not.toHaveProperty("onProgress");
    expect(asked.chk).not.toBe(chk);
    expect([...(asked.chk as Uint8Array)]).toEqual([9, 8, 7]);
    page.say({ type: "scmjs.sim.progress", id: asked.id, stage: "starting", done: 0, total: 0, frame: 0, frames: 0 });
    page.say({ type: "scmjs.sim.progress", id: asked.id, stage: "walking", done: 1, total: 2, frame: 1, frames: 2 });
    page.say({ type: "scmjs.sim.pathed", id: asked.id, pathing: { version: 1, walks: [{ outcome: "arrived" }] } as unknown as PathingResult });
    expect((await got).walks[0].outcome).toBe("arrived");
    expect(seen).toEqual(["starting 0/0", "walking 1/2"]);
  });

  it("hands a script's tests over with the built scenario and resolves with the page's report", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 4, pathing: 1, tests: 1, files: "copy" });
    const bridge = new Bridge("u", host, WORDS);
    expect(await bridge.status()).toMatchObject({ tests: 1 });
    const chk = new Uint8Array([1, 2, 3]);
    const got = bridge.test(chk, "export function runGameTests() {}", { modules: [] });
    await tick();
    const asked = page.sent.find((m) => m.type === "scmjs.sim.test")!;
    expect(asked).toMatchObject({ module: "export function runGameTests() {}", payload: { modules: [] } });
    expect(asked.chk).not.toBe(chk);
    page.say({ type: "scmjs.sim.tested", id: asked.id, report: { results: [{ id: "main.ts::a", status: "passed" }] } });
    expect(await got).toEqual({ results: [{ id: "main.ts::a", status: "passed" }] });
  });

  it("refuses a script's tests on a page from before them, asking nothing", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 4, pathing: 1, files: "copy" });
    await expect(new Bridge("u", host, WORDS).test(new Uint8Array(1), "", {})).rejects.toThrow("no tests");
    expect(page.sent.filter((m) => m.type === "scmjs.sim.test")).toEqual([]);
  });

  it("refuses a map's pathing on a page from before it, asking nothing", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 4, files: "copy" });
    await expect(new Bridge("u", host, WORDS).pathing(new Uint8Array(1))).rejects.toThrow("no pathing");
    expect(page.sent).toEqual([]);
  });

  it("stops a map's pathing when asked, telling the page", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 4, pathing: 1, files: "copy" });
    const stop = new AbortController();
    const got = new Bridge("u", host, WORDS).pathing(new Uint8Array(1), { signal: stop.signal });
    await tick();
    stop.abort();
    await expect(got).rejects.toMatchObject({ name: "AbortError" });
    expect(page.sent.map((m) => m.type)).toEqual(["scmjs.sim.pathing", "scmjs.sim.cancel"]);
  });

  it("hands a map over for its measures and resolves with the page's answer, passing progress on", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 4, pathing: 1, measure: 1, files: "copy" });
    const bridge = new Bridge("u", host, WORDS);
    expect((await bridge.status()).measure).toBe(1);
    const seen: string[] = [];
    const groups = [{ unit: 66, count: 12, from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }];
    const got = bridge.measure(new Uint8Array([5]), { starts: true, groups, onProgress: (p) => seen.push(`${p.stage} ${p.done}/${p.total}`) });
    await tick();
    const asked = page.sent[0];
    expect(asked).toMatchObject({ type: "scmjs.sim.measure", options: { starts: true, groups } });
    expect(asked.options).not.toHaveProperty("onProgress");
    page.say({ type: "scmjs.sim.progress", id: asked.id, stage: "measuring", done: 2, total: 4, frame: 2, frames: 4 });
    page.say({ type: "scmjs.sim.measured", id: asked.id, measure: { version: 1, groups: [], bases: [{ id: 0 }] } as unknown as MeasureResult });
    expect((await got).bases[0].id).toBe(0);
    expect(seen).toEqual(["measuring 2/4"]);
  });

  it("refuses measures on a page from before them, asking nothing", async () => {
    const { page, host } = fakePage({ type: "scmjs.sim.ready", version: 4, pathing: 1, files: "copy" });
    await expect(new Bridge("u", host, WORDS).measure(new Uint8Array(1), { starts: true })).rejects.toThrow("no measure");
    expect(page.sent).toEqual([]);
  });

  it("tells whatever was running when it is closed", async () => {
    const { page, host } = fakePage();
    const bridge = new Bridge("u", host, WORDS);
    const got = bridge.analyse(new Uint8Array(1));
    await tick();
    bridge.close();
    await expect(got).rejects.toThrow("closed");
    expect(page.removed).toBe(1);
  });
});
