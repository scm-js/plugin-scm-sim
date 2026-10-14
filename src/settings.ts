/**
 * How Test Map in Browser plays the map: chosen on the plugin's page under Edit ▸
 * Preferences ▸ Plugins, kept in the plugin's storage, and sent to the play page with the
 * map (`src/play.ts`). The play page fits it to the map: a slot the map does not open to a
 * person, a race the map fixes, or more computers than the map has places, are the map's
 * way instead.
 */

/**
 * `map`: the play page decides, as its setup screen does for a map chosen there — Use Map
 * Settings when the map has a computer player or units placed beyond the start locations,
 * melee otherwise. `setup`: the map opens on the play page's setup screen and nothing
 * starts until Start Game there.
 */
export type GameKind = "map" | "ums" | "melee" | "setup";

export interface TestSettings {
  game: GameKind;
  /** The person's race: 0 zerg, 1 terran, 2 protoss, 6 random. */
  race: number;
  /** Where the person sits in a Use Map Settings game, 0–7; -1 the first slot open to a person. */
  slot: number;
  /** A melee game's computer players, 0–7, all of `computerRace`. */
  computers: number;
  computerRace: number;
}

export const DEFAULT_SETTINGS: TestSettings = { game: "map", race: 6, slot: -1, computers: 1, computerRace: 6 };

/** The storage key. */
export const SETTINGS_KEY = "testMap";

export const RACES = [6, 1, 2, 0] as const;
const GAMES: GameKind[] = ["map", "ums", "melee", "setup"];

/** What was stored, with anything not understood (an older or hand-edited value) as the default. */
export function readSettings(stored: unknown): TestSettings {
  const s = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<Record<keyof TestSettings, unknown>>;
  const race = (v: unknown, fallback: number) => (RACES as readonly unknown[]).includes(v) ? v as number : fallback;
  const whole = (v: unknown, min: number, max: number, fallback: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  return {
    game: GAMES.includes(s.game as GameKind) ? s.game as GameKind : DEFAULT_SETTINGS.game,
    race: race(s.race, DEFAULT_SETTINGS.race),
    slot: whole(s.slot, -1, 7, DEFAULT_SETTINGS.slot),
    computers: whole(s.computers, 0, 7, DEFAULT_SETTINGS.computers),
    computerRace: race(s.computerRace, DEFAULT_SETTINGS.computerRace),
  };
}

/** The settings as the `scmjs.play` message carries them (scm-sim `web/handoff.ts`). */
export interface PlayHow {
  useMapSettings: boolean | null;
  race: number;
  slot?: number;
  computers: number[];
  setup: boolean;
}

export function playHow(s: TestSettings): PlayHow {
  return {
    useMapSettings: s.game === "ums" ? true : s.game === "melee" ? false : null,
    race: s.race,
    ...(s.slot >= 0 ? { slot: s.slot } : {}),
    computers: Array.from({ length: s.computers }, () => s.computerRace),
    setup: s.game === "setup",
  };
}
