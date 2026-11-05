/**
 * Tools ▸ Debug Triggers in Browser: the open map, as Save would write it, played by the game in a panel docked under
 * the map, with what its triggers do pass by pass (scm-sim docs/live-plan.md, D2). The play page is framed in the
 * panel and handed the map with `debug: true` (scm-sim `web/handoff.ts` has the conversation); it sends back the
 * copies of the map's triggers, each pass of them as the game runs it, when it goes back, and where it stands, and takes
 * pause, play, a step of a frame, a step to the next pass and a seek.
 *
 * Beside the game: the controls, a timeline with a column a pass (how many triggers fired, were held at an action or
 * stopped at a condition), and the selected pass's triggers, each saying what became of it. A trigger of the editor's
 * opens in the Trigger Editor on a click; one a build step added (a TrigScript program's) says so.
 *
 * Use Map Settings always: a melee game runs the game's own melee triggers, not the map's.
 */
import type { PanelHandle, PluginApi } from "@scm-js/plugin-api";
import type { SimAddress } from "./address";
import { editorRows, outcomes, Passes, tally, trigRecords, type Outcome, type TriggerCopy } from "./debugModel";
import type { PlayHow } from "./settings";

/** Frames a second at Fastest, for the clock beside the frame. */
const FPS = 1000 / 42;
/** Pixels a pass takes in the timeline. */
const COLUMN = 5;

export interface DebugWords {
  noMap: string;
}

/** The panel, while it is open: `start` hands it a map again (Debug Triggers pressed with the panel up). */
interface Open { start(): void }

export function triggerDebugger(api: PluginApi, address: SimAddress, how: () => PlayHow, words: DebugWords): { run(): void; dispose(): void } {
  const t = api.i18n.t, w = api.ui.widgets;
  let open: Open | null = null;

  let panel: PanelHandle | null = null;
  const run = () => {
    if (open && panel?.isOpen()) { open.start(); return; }
    panel = api.ui.panel({ title: t("Trigger Debugger"), dock: "bottom", height: 440, mount: (body) => mountDebugger(body), onClose: () => { open = null; panel = null; } });
  };

  /** Builds the panel's insides; returns the cleanup. */
  const mountDebugger = (body: HTMLElement): (() => void) => {
    const root = document.createElement("div");
    body.style.height = "100%";
    root.style.cssText = "display:flex;gap:8px;height:100%;min-height:0;box-sizing:border-box;font:var(--fs-sm) var(--font-ui);color:var(--text)";
    const frame = document.createElement("iframe");
    frame.title = t("The game");
    frame.style.cssText = "flex:3 1 0;min-width:320px;border:1px solid var(--border);background:#000";
    const side = document.createElement("div");
    side.style.cssText = "flex:2 1 0;min-width:300px;display:flex;flex-direction:column;gap:6px;min-height:0";

    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:4px;align-items:center;flex-wrap:wrap";
    const where = document.createElement("span");
    where.style.cssText = "margin-left:auto;color:var(--text-dim);font-family:var(--font-mono)";
    const control = (action: string, frameTo?: number) => (pinned = false, frame.contentWindow?.postMessage({ type: "scmjs.play.control", action, ...(frameTo !== undefined ? { frame: frameTo } : {}) }, address.origin));
    let paused = false;
    const play = w.button(t("Pause"), { onClick: () => control(paused ? "resume" : "pause") });
    const back = w.button(t("Previous Pass"), { ghost: true, onClick: () => { const f = passes.frames().filter((x) => x < standing).pop(); control("seek", f ?? 0); } });
    const step = w.button(t("Step Frame"), { ghost: true, onClick: () => control("step") });
    const next = w.button(t("Next Pass"), { ghost: true, onClick: () => control("pass") });
    const again = w.button(t("Restart"), { ghost: true, onClick: () => start() });
    bar.append(play, back, step, next, again, where);

    const strip = document.createElement("div");
    strip.style.cssText = "overflow-x:auto;overflow-y:hidden;border:1px solid var(--border);background:var(--bg-1);flex:none";
    const canvas = document.createElement("canvas");
    canvas.height = 64;
    canvas.style.cssText = "display:block;cursor:pointer";
    canvas.title = t("Each column is a pass of the triggers: green fired, amber held at an action, grey stopped at a condition. Click one to see it.");
    strip.append(canvas);

    const head = document.createElement("div");
    head.style.cssText = "color:var(--text-dim)";
    const list = document.createElement("div");
    list.style.cssText = "flex:1;min-height:0;overflow:auto;border:1px solid var(--border);background:var(--bg-1)";
    side.append(bar, strip, head, list);
    root.append(frame, side);
    body.append(root);

    const passes = new Passes();
    let copies: TriggerCopy[] = [];
    let rows: (number | null)[] = [];
    let names: string[] = [];
    let standing = 0;
    let selected: number | null = null;
    /** A pass the person clicked stays selected as new ones come; a control pressed lets the newest be shown again. */
    let pinned = false;
    let map: { bytes: Uint8Array; name: string } | null = null;
    let ready = false;

    const hand = () => {
      if (!map || !ready || !frame.contentWindow) return;
      frame.contentWindow.postMessage({ type: "scmjs.play", map: map.bytes.slice(), name: map.name, ...how(), useMapSettings: true, debug: true }, address.origin);
    };

    /** The built map, and which of the editor's rows each of its rows is. */
    const start = () => {
      head.textContent = t("Building the map…");
      void (async () => {
        try {
          const file = await api.document.export({ format: "scx" });
          const plain = await api.document.export({ format: "chk", built: false });
          if (!file || !plain) { head.textContent = words.noMap; return; }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const built = trigRecords(await api.document.sections.chkOf(bytes));
          rows = editorRows(built, trigRecords(new Uint8Array(await plain.arrayBuffer())));
          const list = api.triggers.list();
          names = rows.map((r) => {
            if (r === null) return t("A trigger a build step added");
            const comment = list[r]?.actions.find((a) => a.type === 47 && a.text);
            const text = comment ? api.names.string(comment.text) : null;
            return text ? t("Trigger {n}: {comment}", { n: r + 1, comment: text }) : t("Trigger {n}", { n: r + 1 });
          });
          passes.clear(); copies = []; selected = null; pinned = false; standing = 0;
          map = { bytes, name: file.name };
          head.textContent = t("Starting the game…");
          draw(); show();
          if (!frame.src) frame.src = address.play; else hand();
        } catch (err) { head.textContent = t("The map could not be built: {message}", { message: err instanceof Error ? err.message : String(err) }); }
      })();
    };

    const heard = (e: MessageEvent) => {
      if (e.origin !== address.origin || e.source !== frame.contentWindow) return;
      const m = e.data as Record<string, unknown> | null;
      if (!m || typeof m.type !== "string") return;
      switch (m.type) {
        case "scmjs.play.ready": ready = true; hand(); return;
        case "scmjs.play.started":
          // A play page from before the debugger plays the map and sends nothing more.
          setTimeout(() => { if (!copies.length && map) head.textContent = t("The play page did not send the map's triggers. It may be from before the trigger debugger: reload the editor and try again."); }, 8000);
          return;
        case "scmjs.play.error": head.textContent = t("The play page could not start the map: {message}", { message: String(m.message ?? "") }); return;
        case "scmjs.play.triggerCopies":
          copies = Array.isArray(m.copies) ? (m.copies as number[][]).map(([player, place, row]) => ({ player, place, row })) : [];
          head.textContent = t("{n, plural, one {# trigger copy} other {# trigger copies}} in the game. Waiting for the first pass…", { n: copies.length });
          return;
        case "scmjs.play.triggers": {
          const frameAt = Number(m.frame);
          passes.add({ frame: frameAt, records: m.records instanceof Int32Array ? m.records : new Int32Array(0), flags: m.flags instanceof Uint8Array ? m.flags : null, action: m.action instanceof Uint8Array ? m.action : null });
          if (!pinned || selected === null) selected = frameAt;
          draw(); show();
          return;
        }
        case "scmjs.play.rewound": passes.rewound(Number(m.frame)); if (selected !== null && selected > Number(m.frame)) selected = passes.frames().pop() ?? null; draw(); show(); return;
        case "scmjs.play.frame": {
          standing = Number(m.frame) || 0;
          paused = m.paused === true;
          play.textContent = paused ? t("Play") : t("Pause");
          const s = Math.floor(standing / FPS);
          where.textContent = t("Frame {frame} · {time}", { frame: standing, time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` });
          return;
        }
      }
    };
    window.addEventListener("message", heard);

    /** The timeline: a column a pass, stacked by what became of the triggers in it. */
    const draw = () => {
      const frames = passes.frames();
      canvas.width = Math.max(strip.clientWidth || 300, frames.length * COLUMN);
      const g = canvas.getContext("2d");
      if (!g) return;
      const css = getComputedStyle(root);
      const colour = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      g.clearRect(0, 0, canvas.width, canvas.height);
      const most = Math.max(1, ...frames.map((f) => { const k = tally(outcomes(passes.get(f)!, copies.length)); return k.fired + k.held + k.stopped; }));
      frames.forEach((f, i) => {
        const k = tally(outcomes(passes.get(f)!, copies.length)), x = i * COLUMN;
        let y = canvas.height;
        for (const [n, c] of [[k.fired, colour("--ok", "#4c9a52")], [k.held, colour("--warn", "#c9962f")], [k.stopped, colour("--text-faint", "#777")]] as const) {
          const h = Math.round((n / most) * (canvas.height - 4));
          g.fillStyle = c; g.fillRect(x, y - h, COLUMN - 1, h); y -= h;
        }
        if (f === selected) { g.strokeStyle = colour("--gold", "#d4a64a"); g.strokeRect(x + 0.5, 0.5, COLUMN - 2, canvas.height - 1); }
      });
      if (selected === frames[frames.length - 1]) strip.scrollLeft = strip.scrollWidth;
    };
    canvas.addEventListener("click", (e) => {
      const i = Math.floor(e.offsetX / COLUMN), f = passes.frames()[i];
      if (f === undefined) return;
      selected = f; pinned = true; draw(); show();
    });

    /** What an outcome says, in words. */
    const said = (o: Outcome): string => {
      switch (o.kind) {
        case "fired": return t("fired");
        case "wenton": return t("went on and finished");
        case "held": return o.fired ? t("fired, held at action {n}: {action}", { n: o.slot + 1, action: api.names.action(o.type) }) : t("held at action {n}: {action}", { n: o.slot + 1, action: api.names.action(o.type) });
        case "stopped": return t("condition {n} did not hold: {condition}", { n: o.slot + 1, condition: api.names.condition(o.type) });
        case "done": return t("done");
        case "idle": return t("not asked");
      }
    };

    /** The selected pass's triggers that did anything, each a line; a click on one of the editor's opens it. */
    const show = () => {
      list.replaceChildren();
      const pass = selected === null ? null : passes.get(selected);
      if (!pass) { if (copies.length) head.textContent = t("No pass yet."); return; }
      const s = Math.floor(pass.frame / FPS);
      const got = outcomes(pass, copies.length);
      const k = tally(got);
      head.textContent = t("The pass at frame {frame} ({time}): {fired} fired, {held} held, {stopped} stopped", { frame: pass.frame, time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, fired: k.fired, held: k.held, stopped: k.stopped });
      got.forEach((o, i) => {
        if (o.kind === "idle" || o.kind === "done") return;
        const c = copies[i], row = c ? rows[c.row] ?? null : null;
        const line = document.createElement("div");
        line.style.cssText = "display:flex;gap:8px;padding:2px 6px;border-bottom:1px solid var(--line-lo)" + (row !== null ? ";cursor:pointer" : "");
        const who = document.createElement("span");
        who.style.cssText = "color:var(--text-dim);flex:none;width:68px";
        who.textContent = api.names.player(c?.player ?? 0);
        const name = document.createElement("span");
        name.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        name.textContent = c ? names[c.row] ?? t("Trigger {n}", { n: c.row + 1 }) : "?";
        const what = document.createElement("span");
        what.style.cssText = "flex:none;color:" + (o.kind === "stopped" ? "var(--text-faint)" : o.kind === "held" ? "var(--warn)" : "var(--ok)");
        what.textContent = said(o);
        line.append(who, name, what);
        if (row !== null) {
          line.title = t("Open it in the Trigger Editor");
          line.addEventListener("click", () => api.view.goTo({ kind: "trigger", index: row }));
        }
        list.append(line);
      });
      if (!list.childElementCount) { const none = document.createElement("div"); none.style.cssText = "padding:6px;color:var(--text-faint)"; none.textContent = t("Nothing ran in this pass."); list.append(none); }
    };

    open = { start };
    start();
    return () => { window.removeEventListener("message", heard); frame.src = "about:blank"; open = null; };
  };

  return { run, dispose: () => { panel?.close(); open = null; } };
}
