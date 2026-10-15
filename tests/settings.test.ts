import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, playHow, readSettings } from "../src/settings";

describe("Test Map in Browser's settings", () => {
  it("start as the map decides, with one random computer for melee", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(playHow(DEFAULT_SETTINGS)).toEqual({ useMapSettings: null, race: 6, computers: [6], setup: false });
  });

  it("read back what was stored, and the default for anything not understood", () => {
    expect(readSettings({ game: "melee", race: 2, slot: 3, computers: 7, computerRace: 0 })).toEqual({ game: "melee", race: 2, slot: 3, computers: 7, computerRace: 0 });
    expect(readSettings({ game: "coop", race: 5, slot: 8, computers: 2.5, computerRace: "zerg" })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings("melee")).toEqual(DEFAULT_SETTINGS);
  });

  it("say which kind of game to the play page", () => {
    expect(playHow({ ...DEFAULT_SETTINGS, game: "ums", slot: 2 })).toMatchObject({ useMapSettings: true, slot: 2, setup: false });
    expect(playHow({ ...DEFAULT_SETTINGS, game: "melee", computers: 3, computerRace: 1 })).toMatchObject({ useMapSettings: false, computers: [1, 1, 1] });
    expect(playHow({ ...DEFAULT_SETTINGS, game: "setup" })).toMatchObject({ useMapSettings: null, setup: true });
  });

  it("leave the slot to the play page when it is the first open one", () => {
    expect(playHow({ ...DEFAULT_SETTINGS, game: "ums" })).not.toHaveProperty("slot");
  });
});
