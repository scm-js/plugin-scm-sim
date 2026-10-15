import { describe, expect, it } from "vitest";
import type { ViewCamera, ViewFrame, ViewKey } from "../contract";
import { ViewBridge, type ViewFrameHost } from "../src/view";

const WORDS = { noAnswer: "no answer", noFiles: "no files", replaced: "replaced", closed: "closed" };
const element = {} as HTMLElement;

/** A stand-in for the play page's viewer: what it was sent, and a way to speak as it. */
function fakeViewer(ready: object | null = { type: "scmjs.view.ready", version: 1, files: "copy" }) {
  const sent: { type: string; [k: string]: unknown }[] = [];
  const page = { sent, removed: 0, inside: null as HTMLElement | null, say: (_m: object) => {} };
  const host: ViewFrameHost = (_url, el, heard) => {
    page.inside = el;
    page.say = heard;
    if (ready) queueMicrotask(() => heard(ready));
    return { post: (m) => { sent.push(m as typeof sent[number]); }, remove: () => { page.removed++; } };
  };
  return { page, host };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const LOOKS = { remastered: true, remasteredOn: true, lighting: false, lightingOn: false };
const LOADED = { type: "scmjs.view.loaded", name: "a.rep", frames: 900, players: [{ slot: 0, name: "A", race: 1 }], map: { width: 128, height: 96 }, rewinds: true, looks: LOOKS };

describe("the game view inside an element", () => {
  it("is made in the element given and says what the page found of the game's files", async () => {
    const yes = fakeViewer();
    const view = new ViewBridge("u", element, yes.host, WORDS);
    expect(yes.page.inside).toBe(element);
    expect(await view.ready).toEqual({ files: "copy", reason: null });
    const no = fakeViewer({ type: "scmjs.view.ready", version: 1, files: null, why: "install it" });
    expect(await new ViewBridge("u", element, no.host, WORDS).ready).toEqual({ files: null, reason: "install it" });
    const silent = fakeViewer(null);
    expect(await new ViewBridge("u", element, silent.host, WORDS, 5).ready).toEqual({ files: null, reason: "no answer" });
  });

  it("loads a replay, a copy of its bytes, and resolves with what the page says of it", async () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const bytes = new Uint8Array([1, 2, 3]);
    const loading = view.load(bytes, "a.rep");
    await tick();
    expect(page.sent[0]).toMatchObject({ type: "scmjs.view.load", name: "a.rep" });
    expect(page.sent[0].replay).toEqual(bytes);
    expect(page.sent[0].replay).not.toBe(bytes);
    page.say(LOADED);
    expect(await loading).toEqual({ name: "a.rep", frames: 900, players: [{ slot: 0, name: "A", race: 1 }], map: { width: 128, height: 96 }, rewinds: true, looks: LOOKS });
  });

  it("rejects a load the page could not play, one replaced by another, and one with no game files", async () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const bad = view.load(new Uint8Array(1));
    await tick();
    page.say({ type: "scmjs.view.error", message: "not a replay" });
    await expect(bad).rejects.toThrow("not a replay");
    const first = view.load(new Uint8Array(1)), second = view.load(new Uint8Array(2));
    await expect(first).rejects.toThrow("replaced");
    page.say(LOADED);
    await expect(second).resolves.toMatchObject({ frames: 900 });
    const none = fakeViewer({ type: "scmjs.view.ready", files: null, why: "install it" });
    await expect(new ViewBridge("u", element, none.host, WORDS).load(new Uint8Array(1))).rejects.toThrow("install it");
  });

  it("drives the page, and answers options with the looks the page says", async () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    view.play(true); view.speed(8); view.seek(1500.7); view.camera(100, 200); view.player(2);
    expect(page.sent.map((m) => m.type.replace("scmjs.view.", ""))).toEqual(["play", "speed", "seek", "camera", "player"]);
    expect(page.sent[2].frame).toBe(1500);
    const looks = view.options({ remastered: false });
    expect(page.sent[5]).toEqual({ type: "scmjs.view.options", remastered: false });
    page.say({ type: "scmjs.view.looks", ...LOOKS, remasteredOn: false });
    expect(await looks).toEqual({ ...LOOKS, remasteredOn: false });
  });

  it("passes the frame, the camera and the keys on to whoever listens, until they stop", () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const frames: ViewFrame[] = [], cameras: ViewCamera[] = [], keys: ViewKey[] = [];
    const f = view.onFrame((x) => frames.push(x));
    view.onCamera((x) => cameras.push(x));
    view.onKey((x) => keys.push(x));
    page.say({ type: "scmjs.view.frame", frame: 240, playing: true, seeking: null });
    page.say({ type: "scmjs.view.camera", x: 10, y: 20, width: 640, height: 375, byUser: true });
    page.say({ type: "scmjs.view.key", key: " ", code: "Space", shiftKey: false });
    // (Not the view's: another page's messages, or none of its kind.)
    page.say({ type: "scmjs.sim.ready" });
    f.dispose();
    page.say({ type: "scmjs.view.frame", frame: 480, playing: false, seeking: 240 });
    expect(frames).toEqual([{ frame: 240, playing: true, seeking: null }]);
    expect(cameras).toEqual([{ x: 10, y: 20, width: 640, height: 375, byUser: true }]);
    expect(keys).toEqual([{ key: " ", code: "Space", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }]);
  });

  it("takes the frame away on dispose, rejects what was waiting and says nothing more", async () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const loading = view.load(new Uint8Array(1));
    await tick();
    const frames: ViewFrame[] = [];
    view.onFrame((x) => frames.push(x));
    view.dispose();
    view.dispose();
    await expect(loading).rejects.toThrow("closed");
    expect(page.removed).toBe(1);
    page.say({ type: "scmjs.view.frame", frame: 1, playing: true, seeking: null });
    expect(frames).toEqual([]);
    view.play(true);
    expect(page.sent.filter((m) => m.type === "scmjs.view.play")).toEqual([]);
    await expect(view.options({ fog: true })).rejects.toThrow("closed");
  });
});
