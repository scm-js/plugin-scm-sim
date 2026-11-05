/**
 * Test in Browser as one of the editor's test targets (`api.ui.testTarget`, editor 0.8.6):
 * a choice beside StarCraft on Edit ▸ Preferences ▸ Testing, with this plugin's settings
 * under it, and a Tools menu item the editor draws. An editor from before has no such
 * call; `plugin.ts` then adds Tools ▸ Test Map in Browser itself, as before.
 *
 * The call is declared here rather than taken from `@scm-js/plugin-api`, so the plugin
 * builds against a package from before it and runs on an editor from before it.
 */
import type { PluginApi, PreferencesPageSpec } from "@scm-js/plugin-api";

/** A map as a test target is handed it. */
export interface TestMapFile { bytes: Uint8Array; name: string }

/** The editor's `TestTargetSpec`. */
export interface TestTargetSpec {
  label: string;
  menuLabel: string;
  description?: string;
  run(map: Promise<TestMapFile | null>): void | Promise<string | void>;
  settings?: PreferencesPageSpec;
}

/** `api.ui.testTarget`, where the editor has it. */
export function testTargetCall(api: PluginApi): ((spec: TestTargetSpec) => { dispose(): void }) | null {
  const call = (api.ui as unknown as { testTarget?: (spec: TestTargetSpec) => { dispose(): void } }).testTarget;
  return typeof call === "function" ? call.bind(api.ui) : null;
}
