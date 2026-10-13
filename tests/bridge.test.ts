import { describe, expect, it } from "vitest";
import type { ReplayTimeline } from "../contract";
import { Bridge, type FrameHost } from "../src/bridge";

const WORDS = { noAnswer: "no answer", noFiles: "no files", closed: "closed" };
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
    expect(await new Bridge("u", yes.host, WORDS).status()).toEqual({ available: true, files: "copy", reason: null, timeline: 1 });
    const no = fakePage({ type: "scmjs.sim.ready", version: 1, files: null, why: "install it" });
    expect(await new Bridge("u", no.host, WORDS).status()).toEqual({ available: false, files: null, reason: "install it", timeline: 1 });
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
