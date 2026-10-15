/**
 * The plugin's page under Edit ▸ Preferences ▸ Plugins: what the library is, whether the
 * engine can run a game here now, and how Test Map in Browser plays the map
 * (`src/settings.ts`). The check needs no OK; the settings are kept on OK or Apply.
 */
import type { PluginApi } from "@scm-js/plugin-api";
import type { ScmSimService } from "../contract";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type GameKind, type TestSettings } from "./settings";

export function registerPreferencesPage(api: PluginApi, service: ScmSimService, settings: () => TestSettings) {
  const t = api.i18n.t;
  const w = api.ui.widgets;
  let pending: (() => void) | null = null;
  let reset: (() => void) | null = null;
  return api.ui.preferencesPage({
    mount(body) {
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

      // How Test Map in Browser plays the map.
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
        w.hint(t("scm-sim is the game engine behind the site's play page. This plugin lets other plugins use it: a replay tool can have a replay played to its end and learn what really happened in it, and a map can be started in a browser tab. Its one menu item is Tools ▸ Test Map in Browser.")),
        w.hint(t("The engine runs in your browser from your own copy of StarCraft. A replay or a map handed to it is not stored and not sent anywhere.")),
        line, w.row(again),
        w.group(t("Test Map in Browser"),
          w.form([
            { label: t("Game type"), field: game },
            { label: t("Your race"), field: race },
            { label: t("Your slot"), field: slot },
            { label: t("Computers"), field: computers },
            { label: t("Computer race"), field: computerRace },
          ]),
          w.hint(t("From the map: Use Map Settings when the map has computer players or units placed beyond the start locations, melee otherwise. Choose on the play page: the map opens on the play page's setup screen, and nothing starts until you press Start Game there.")),
          w.hint(t("Your slot is for Use Map Settings, the computers for melee. Where the map fixes a slot's race, or has fewer places, the map wins.")),
        ),
      );
      void check();
      return () => { live = false; pending = null; reset = null; };
    },
    apply: () => pending?.(),
    reset: () => reset?.(),
  });
}
