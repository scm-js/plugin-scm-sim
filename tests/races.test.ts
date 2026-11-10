import { describe, expect, it } from "vitest";
import { validRaces } from "../src/races";
import { validDataSet, validReplayDataSet } from "../src/play";
import { analysedDataSet } from "../src/bridge";

/** A mod's fourth race as its replays hold it (byte 69), and a row of each wrong kind. */
const RACES = [{ id: 70, name: "Second" }, { id: 69, name: " Askosi ", letter: "a", like: 1, notes: "kept" }];
const WRONG = [null, { id: 3, name: "The game's" }, { id: 256, name: "Too far" }, { id: 9, name: " " }, { id: 10, name: "x".repeat(41) }, { id: 11, name: "Ok", letter: "AB", like: 4 }, { id: 11, name: "Again" }];

describe("the races a data set adds (0.20.0)", () => {
  it("keeps valid rows sorted by id, trimmed, their other fields as given", () => {
    expect(validRaces(RACES)).toEqual([{ id: 69, name: "Askosi", letter: "a", like: 1, notes: "kept" }, { id: 70, name: "Second" }]);
  });
  it("leaves out what is not a valid row, never throwing", () => {
    expect(validRaces(WRONG)).toEqual([{ id: 11, name: "Ok" }]);
    expect(validRaces("no")).toEqual([]);
  });
  it("ride every data set handed to the pages, unchanged but for invalid rows", () => {
    const races = validRaces(RACES);
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", races: RACES })).toEqual({ hash: "ac3f86533e4b5a31", races });
    expect(analysedDataSet({ hash: "ac3f86533e4b5a31", races: RACES as never })).toEqual({ hash: "ac3f86533e4b5a31", races });
    expect(validDataSet({ id: "my-mod", name: "My Mod", hash: "ab12", races: RACES })).toEqual({ id: "my-mod", name: "My Mod", hash: "ab12", races });
  });
  it("are left out where none is valid: the message is as before", () => {
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", races: [{ id: 2, name: "Protoss" }] })).toEqual({ hash: "ac3f86533e4b5a31" });
    expect(analysedDataSet({ hash: "ac3f86533e4b5a31", races: [] })).toEqual({ hash: "ac3f86533e4b5a31" });
    expect(validDataSet({ id: "my-mod" })).toEqual({ id: "my-mod", name: "my-mod", hash: "" });
  });
});
