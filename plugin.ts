/**
 * scm-sim — a library plugin for the scmJS map editor (https://github.com/scm-js/scm-js):
 * the way from the editor to scm-sim, the game engine behind the site's play page. It has
 * no editor of its own and no engine in it; it holds one service, `scm-sim.engine`, that
 * other plugins reach the engine through — a replay played to its end for what happened
 * in it, a map's pathing as the game walks it, measures of a map taken by the game, a map started in a browser tab — one menu item, Tools ▸ Test Map in Browser, and
 * a page under Edit ▸ Preferences ▸ Plugins: whether the engine can run a game, and how
 * Test Map in Browser plays the map (`src/settings.ts`). The engine is another program on the editor's own origin, talked to by message
 * (`src/bridge.ts`, `src/play.ts`). See `contract.d.ts` for the service and README.md for
 * the rest.
 */
import type { PluginApi } from "@scm-js/plugin-api";
import type { ScmSimService } from "./contract";
import { simAddress } from "./src/address";
import { Bridge, domFrames } from "./src/bridge";
import { domViewFrames, pressOnWindow, ViewBridge } from "./src/view";
import { registerPreferencesPage } from "./src/page";
import { PlayTab } from "./src/play";
import { playHow, readSettings, SETTINGS_KEY } from "./src/settings";
import { KO } from "./ko";

/** Marks a string the editor translates when it draws it (a menu label, a command's title), so the catalogue's test finds it. */
const msg = (text: string) => text;

/** `ServiceInfo.version`: goes up when `contract.d.ts` changes in a way a consumer must know of. */
const SERVICE_VERSION = 1;

export function activate(api: PluginApi): () => void {
  const catalogue = api.i18n.register({ ko: KO });
  const t = api.i18n.t;
  const address = typeof location === "undefined" ? null : simAddress(location);
  const absent = () => new Error(t("This editor has no play page beside it, so the engine cannot be reached from here. It is at scmjs.dev."));
  const bridge = address && new Bridge(address.analyse, domFrames(address.origin), {
    noAnswer: t("The engine's page did not answer."),
    noFiles: t("This browser has no copy of StarCraft to play from. Give the site your game on the Game Data page."),
    closed: t("The engine was closed before it finished."),
    noPathing: t("The engine's page cannot work out a map's pathing yet. Reload the editor and try again."),
    noMeasure: t("The engine's page cannot measure a map yet. Reload the editor and try again."),
    noTests: t("The engine's page cannot run a script's tests in the game yet. Reload the editor and try again."),
    noDebug: t("The engine's page cannot debug a test in the game yet. Reload the editor and try again."),
    sessionOver: t("That debugging session is over."),
    noCopies: t("A test of several players runs a copy of the game for each, which needs memory shared between them: this browser does not allow that on the engine's page (Chrome and Edge from version 137 do), or the page is from before it."),
  });
  const tab = address && new PlayTab(address, {
    blocked: t("The browser did not let the play page open. Allow pop-ups for this site and try again."),
    noMap: t("There is no map to play."),
    replaced: t("Another map was started in its place."),
  });

  const settings = () => readSettings(api.storage.get<unknown>(SETTINGS_KEY, null));
  /** The map (left out: the open one, as Save would write it) played as the Preferences page says. */
  const test = (map?: { bytes: Uint8Array; name: string }) => {
    if (!tab) throw absent();
    // Not awaited before the tab is opened: `play` opens it first.
    const open = async () => { const file = await api.document.export({ format: "scx" }); return file ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } : null; };
    return tab.play(map ?? open(), playHow(settings()));
  };

  /** The open map as the editor holds it (its build steps change triggers, not the ground), for `pathing` and `measure`. */
  const openScenario = async () => {
    const file = api.document.isOpen() ? await api.document.export({ format: "chk", built: false }) : null;
    if (!file) throw new Error(t("There is no map open."));
    return new Uint8Array(await file.arrayBuffer());
  };

  /** The game views other plugins asked for; they go with this plugin. */
  const views = new Set<ViewBridge>();
  const service: ScmSimService = {
    present: address !== null,
    status: async () => bridge ? bridge.status() : { available: false, files: null, reason: absent().message, timeline: null, pathing: null, measure: null, tests: null, copies: null, debug: null },
    analyse: async (replay, options) => { if (!bridge) throw absent(); return bridge.analyse(replay, options); },
    play: async (map) => { await test(map); },
    pathing: async (scenario, options) => {
      if (!bridge) throw absent();
      return bridge.pathing(scenario ?? await openScenario(), options);
    },
    measure: async (scenario, options) => {
      if (!bridge) throw absent();
      return bridge.measure(scenario ?? await openScenario(), options);
    },
    test: async (scenario, module, payload, options) => { if (!bridge) throw absent(); return bridge.test(scenario, module, payload, options); },
    testCopies: async (scenario, module, payload, options) => { if (!bridge) throw absent(); return bridge.testCopies(scenario, module, payload, options); },
    debug: async (scenario, module, payload, options) => { if (!bridge) throw absent(); return bridge.debug(scenario, module, payload, options); },
    view: (element) => {
      if (!address) throw absent();
      const view = new ViewBridge(address.view, element, domViewFrames(address.origin), {
        noAnswer: t("The engine's page did not answer."),
        noFiles: t("This browser has no copy of StarCraft to play from. Give the site your game on the Game Data page."),
        replaced: t("Another replay was loaded in its place."),
        closed: t("The game view was closed."),
      });
      // The keys the view does not use are the editor's: pressed again on its window.
      view.onKey(pressOnWindow);
      views.add(view);
      const dispose = view.dispose.bind(view);
      view.dispose = () => { views.delete(view); dispose(); };
      return view;
    },
  };
  const provided = api.services.provide("engine", service, { version: SERVICE_VERSION });
  const page = registerPreferencesPage(api, service, settings);
  // Tools ▸ Test Map in Browser, where there is a play page to hand the map to.
  const menu = address ? [
    api.commands.register({
      id: "play",
      title: msg("Test Map in Browser"),
      enabled: () => api.document.isOpen(),
      run: () => test().then(
        (outcome) => api.ui.status(outcome === "shown" ? t("The map is on the play page's setup screen.") : t("The map is running on the play page.")),
        (err) => api.ui.status(t("The play page could not start the map: {message}", { message: err instanceof Error ? err.message : String(err) })),
      ),
    }),
    api.menu.add("Tools", { label: msg("Test Map in Browser"), icon: "plugin", after: "Test Map Settings…", command: "play" }),
  ] : [];
  return () => { for (const v of [...views]) v.dispose(); for (const m of menu) m.dispose(); provided.dispose(); page.dispose(); bridge?.close(); tab?.dispose(); catalogue.dispose(); };
}
