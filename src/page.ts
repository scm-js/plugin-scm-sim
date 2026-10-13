/**
 * The plugin's page under Edit ▸ Preferences ▸ Plugins: what the library is, and whether
 * the engine can run a game here now. Nothing on it waits for OK.
 */
import type { PluginApi } from "@scm-js/plugin-api";
import type { ScmSimService } from "../contract";

export function registerPreferencesPage(api: PluginApi, service: ScmSimService) {
  const t = api.i18n.t;
  const w = api.ui.widgets;
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
      body.append(
        w.hint(t("scm-sim is the game engine behind the site's play page. This plugin lets other plugins use it: a replay tool can have a replay played to its end and learn what really happened in it, and a map can be started in a browser tab. Its one menu item is Tools ▸ Test Map in Browser.")),
        w.hint(t("The engine runs in your browser from your own copy of StarCraft. A replay or a map handed to it is not stored and not sent anywhere.")),
        line, w.row(again),
      );
      void check();
      return () => { live = false; };
    },
  });
}
