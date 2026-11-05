import { describe, expect, it } from "vitest";
import type { ViewCamera, ViewFrame, ViewHover, ViewKey, ViewUnits, ViewPointer, ViewWheel } from "../contract";
import { ViewBridge, type ViewFrameHost } from "../src/view";

const WORDS = { noAnswer: "no answer", noFiles: "no files", replaced: "replaced", closed: "closed", noDebug: "no debug" };
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
  it("starts a debugged run's map and draws its pictures, saying an error no request waits on", async () => {
    const { page, host } = fakeViewer({ type: "scmjs.view.ready", version: 1, debug: 1, files: "copy" });
    const view = new ViewBridge("u", element, host, WORDS);
    const map = new Uint8Array([9]);
    const started = view.debug(map);
    await tick();
    expect(page.sent[0]).toMatchObject({ type: "scmjs.view.debug" });
    expect(page.sent[0].map).toEqual(map);
    expect(page.sent[0].map).not.toBe(map);
    page.say({ type: "scmjs.view.debugged", map: { width: 64, height: 64 } });
    expect(await started).toEqual({ map: { width: 64, height: 64 } });
    const shown: number[] = [], errors: string[] = [];
    view.onShown((f) => shown.push(f));
    view.onError((e) => errors.push(e));
    view.show({ frame: 12, kept: { base: "b" } });
    expect(page.sent.at(-1)).toEqual({ type: "scmjs.view.show", kept: { base: "b" } });
    page.say({ type: "scmjs.view.shown", frame: 12 });
    page.say({ type: "scmjs.view.error", message: "another map" });
    expect(shown).toEqual([12]);
    expect(errors).toEqual(["another map"]);
    // A refusal of the map itself goes to the request.
    const again = view.debug(map);
    await tick();
    page.say({ type: "scmjs.view.error", message: "Playing needs StarCraft installed" });
    await expect(again).rejects.toThrow("Playing needs StarCraft installed");
  });

  it("refuses a debugged run's map on a page from before the debugger", async () => {
    const { page, host } = fakeViewer();
    await expect(new ViewBridge("u", element, host, WORDS).debug(new Uint8Array([1]))).rejects.toThrow("no debug");
    expect(page.sent).toEqual([]);
  });

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
    expect(await loading).toEqual({ name: "a.rep", frames: 900, players: [{ slot: 0, name: "A", race: 1 }], map: { width: 128, height: 96 }, rewinds: true, looks: LOOKS, follows: false });
    // (A page that plays camera tracks says so.)
    const again = view.load(bytes, "a.rep");
    await tick();
    page.say({ ...LOADED, follows: true });
    expect(await again).toMatchObject({ follows: true });
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

  it("asks for a scale with the camera, and passes the minimap's squares on", () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    view.camera(100, 200, 960);
    view.camera(100, 200, 0);
    expect(page.sent).toEqual([{ type: "scmjs.view.camera", x: 100, y: 200, height: 960 }, { type: "scmjs.view.camera", x: 100, y: 200 }]);
    const heard: ViewUnits[] = [];
    view.onUnits((u) => heard.push(u));
    const boxes = Float32Array.from([64, 96, 32, 32]), colours = Uint32Array.from([0xf40404]);
    page.say({ type: "scmjs.view.units", frame: 0, boxes, colours });
    // (Squares that do not add up are not passed on.)
    page.say({ type: "scmjs.view.units", frame: 1, boxes: new Float32Array(3), colours });
    page.say({ type: "scmjs.view.units", frame: 2, boxes: [64, 96, 32, 32], colours: [1] });
    expect(heard).toEqual([{ frame: 0, boxes, colours, fog: null, wide: 0 }]);
  });

  it("passes the fog on with the squares, when it is whole rows of the map", () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const heard: ViewUnits[] = [];
    view.onUnits((u) => heard.push(u));
    const boxes = new Float32Array(0), colours = new Uint32Array(0), fog = Uint8Array.from([0, 1, 2, 2, 1, 0]);
    page.say({ type: "scmjs.view.units", frame: 0, boxes, colours, fog, wide: 3 });
    page.say({ type: "scmjs.view.units", frame: 1, boxes, colours, fog, wide: 4 });
    expect(heard.map((u) => [u.fog, u.wide])).toEqual([[fog, 3], [null, 0]]);
  });

  it("passes on what is under the pointer, checked, and null for nothing", () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const heard: (ViewHover | null)[] = [];
    view.onHover((h) => heard.push(h));
    const unit = { id: 12, type: 111, owner: 1, hp: 500, hpMax: 1500, invincible: false, shields: -1, shieldsMax: 0, energy: -1, energyMax: 0, completed: true, work: "train", workId: 0, progress: 40, queue: [0, 0, 1], resources: -1 };
    page.say({ type: "scmjs.view.hover", unit, x: 120, y: 80 });
    page.say({ type: "scmjs.view.hover", unit: { ...unit, work: "dance", queue: [0, "x", -1] }, x: 1, y: 2 });
    page.say({ type: "scmjs.view.hover", unit: null });
    expect(heard).toEqual([{ unit, x: 120, y: 80 }, { unit: { ...unit, work: null, queue: [0] }, x: 1, y: 2 }, null]);
  });

  it("passes on the wheel, checked", () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const heard: ViewWheel[] = [];
    view.onWheel((w) => heard.push(w));
    page.say({ type: "scmjs.view.wheel", deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, x: 1500, y: 1200 });
    page.say({ type: "scmjs.view.wheel", deltaY: "3", ctrlKey: 1, x: Infinity, y: 7 });
    expect(heard).toEqual([
      { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, x: 1500, y: 1200 },
      { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, x: 0, y: 7 },
    ]);
  });

  it("passes on the map pixel under the pointer, checked, and null once it is off", () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const heard: (ViewPointer | null)[] = [];
    view.onPointer((p) => heard.push(p));
    page.say({ type: "scmjs.view.pointer", pointer: { x: 1500, y: 1200 } });
    page.say({ type: "scmjs.view.pointer", pointer: { x: "3", y: 7 } });
    page.say({ type: "scmjs.view.pointer", pointer: null });
    expect(heard).toEqual([{ x: 1500, y: 1200 }, null, null]);
  });

  it("sends a camera track as a copy, and null to stop following", () => {
    const { page, host } = fakeViewer();
    const view = new ViewBridge("u", element, host, WORDS);
    const track = { every: 2, x: Float32Array.from([10, 20]), y: Float32Array.from([30, 40]), cut: Uint8Array.from([1, 0]) };
    view.follow(track);
    view.follow(null);
    expect(page.sent).toEqual([{ type: "scmjs.view.follow", track }, { type: "scmjs.view.follow", track: null }]);
    expect((page.sent[0].track as typeof track).x).not.toBe(track.x);
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
