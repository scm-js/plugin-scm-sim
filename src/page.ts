/**
 * What the plugin shows in Edit ▸ Preferences. Its own page under Plugins says what the
 * library is and whether the engine can run a game here now. How Test in Browser plays
 * the map (`src/settings.ts`) is a form of its own: on Preferences ▸ Testing beside
 * StarCraft where the editor has test targets (`src/target.ts`), on this page where it
 * has not. The check needs no OK; the settings are kept on OK or Apply.
 */
import type { PluginApi, PreferencesPageSpec } from "@scm-js/plugin-api";
import type { ScmSimService } from "../contract";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type GameKind, type TestSettings } from "./settings";

/** The form for how a map is played: game type, race, slot, computers. */
export function testSettingsForm(api: PluginApi, settings: () => TestSettings): PreferencesPageSpec {
  const t = api.i18n.t;
  const w = api.ui.widgets;
  let pending: (() => void) | null = null;
  let reset: (() => void) | null = null;
  return {
    mount(body) {
      const races = () => [
        { value: 6, label: t("Random") }, { value: 1, label: t("Terran") }, { value: 2, label: t("Protoss") }, { value: 0, label: t("Zerg") },
      ];
      const s = settings();
      const game = w.select([
        { value: "map", label: t("From the map") },
        { value: "ums", label: t("Use Map Settings") },
        { value: "melee", label: t("Melee") },
        { value: "setup", label: t("Choose on the play page") },
      ], { value: s.game, onChange: () => fit() });
      const race = w.select(races(), { value: s.race });
      const slot = w.select([
        { value: -1, label: t("The first open slot") },
        ...Array.from({ length: 8 }, (_, i) => ({ value: i, label: t("Player {n}", { n: i + 1 }) })),
      ], { value: s.slot });
      const computers = w.number({ value: s.computers, min: 0, max: 7, step: 1 });
      const computerRace = w.select(races(), { value: s.computerRace });
      /** The fields the chosen kind of game has no use for are greyed out. */
      const fit = () => {
        const kind = game.value as GameKind;
        race.disabled = kind === "setup";
        slot.disabled = kind === "melee" || kind === "setup";
        computers.disabled = computerRace.disabled = kind === "ums" || kind === "setup";
      };
      const show = (v: TestSettings) => {
        game.value = v.game; race.value = String(v.race); slot.value = String(v.slot);
        computers.value = String(v.computers); computerRace.value = String(v.computerRace);
        fit();
      };
      fit();
      pending = () => {
        const n = Math.round(Number(computers.value));
        api.storage.set(SETTINGS_KEY, {
          game: game.value as GameKind,
          race: Number(race.value),
          slot: Number(slot.value),
          computers: Number.isFinite(n) ? Math.min(7, Math.max(0, n)) : DEFAULT_SETTINGS.computers,
          computerRace: Number(computerRace.value),
        } satisfies TestSettings);
      };
      reset = () => show(DEFAULT_SETTINGS);
      body.append(
        w.form([
          { label: t("Game type"), field: game },
          { label: t("Your race"), field: race },
          { label: t("Your slot"), field: slot },
          { label: t("Computers"), field: computers },
          { label: t("Computer race"), field: computerRace },
        ]),
        w.hint(t("From the map: Use Map Settings when the map has computer players or units placed beyond the start locations, melee otherwise. Choose on the play page: the map opens on the play page's setup screen, and nothing starts until you press Start Game there.")),
        w.hint(t("Your slot is for Use Map Settings, the computers for melee. Where the map fixes a slot's race, or has fewer places, the map wins.")),
      );
      return () => { pending = null; reset = null; };
    },
    apply: () => pending?.(),
    reset: () => reset?.(),
  };
}

/**
 * The page under Plugins. `form`: the test settings, drawn here only when the editor has
 * nowhere else for them (an editor from before test targets, with a play page beside it).
 */
export function registerPreferencesPage(api: PluginApi, service: ScmSimService, form: PreferencesPageSpec | null) {
  const t = api.i18n.t;
  const w = api.ui.widgets;
  return api.ui.preferencesPage({
    mount(body, page) {
      const line = w.statusLine();
      let live = true;
      const check = async () => {
        if (!service.present) { line.set(t("This editor has no play page beside it, so the engine cannot be reached from here. It is at scmjs.dev."), "warn"); return; }
        line.busy(t("Asking the engine…"));
        const s = await service.status();
        if (!live) return;
        if (!s.available) line.set(s.reason ?? t("The engine cannot run a game here."), "warn");
        else if (s.files === "archives") line.set(t("Ready. It plays from your StarCraft 1.16.1 files."), "ok");
        else if (s.files === "copy") line.set(t("Ready. It plays from the copy of StarCraft you gave the site."), "ok");
        else line.set(t("Ready. It plays from this development server's files."), "ok");
      };
      const again = w.button(t("Check again"), { onClick: () => void check() });
      again.hidden = !service.present;
      body.append(
        w.hint(t("scm-sim is the game engine behind the site's play page. This plugin lets other plugins use it: a replay tool can have a replay played to its end and learn what really happened in it, and a map can be started in a browser tab.")),
        w.hint(t("The engine runs in your browser from your own copy of StarCraft. A replay or a map handed to it is not stored and not sent anywhere.")),
        line, w.row(again),
      );
      let unmount: void | (() => void);
      if (form) {
        const group = w.group(t("Test Map in Browser"));
        body.append(group);
        unmount = form.mount(group, page);
      } else if (service.present) {
        body.append(w.hint(t("Tools ▸ Test in Browser plays the open map in a tab. How it plays it is set under Edit ▸ Preferences ▸ Testing, beside StarCraft.")));
      }
      void check();
      return () => { live = false; unmount?.(); };
    },
    apply: () => form?.apply?.(),
    reset: () => form?.reset?.(),
  });
}
