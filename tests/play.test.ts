import { describe, expect, it } from "vitest";
import { validDataSet, validReplayDataSet } from "../src/play";

describe("the data set a map is played with", () => {
  it("passes the editor's three fields through", () => {
    expect(validDataSet({ id: "my-mod", name: "My Mod", hash: "ab12" })).toEqual({ id: "my-mod", name: "My Mod", hash: "ab12" });
  });
  it("names it by its id and leaves the hash empty when the editor knew none", () => {
    expect(validDataSet({ id: "my-mod" })).toEqual({ id: "my-mod", name: "my-mod", hash: "" });
  });
  it("sends nothing for the game's own data or an editor from before", () => {
    expect(validDataSet(undefined)).toBeNull();
    expect(validDataSet({ name: "No id" })).toBeNull();
  });
});

describe("the mod a replay was played with (playReplay's dataSet)", () => {
  it("takes a hash of 16 hex digits with its name and web address", () => {
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", name: " Cosmonarchy ", url: "https://fraudsclub.com/cosmonarchy-bw/" })).toEqual({ hash: "ac3f86533e4b5a31", name: "Cosmonarchy", url: "https://fraudsclub.com/cosmonarchy-bw/" });
  });
  it("leaves out what is not text, and an address that is not the web's", () => {
    expect(validReplayDataSet({ hash: "ac3f86533e4b5a31", name: 3, url: "javascript:alert(1)" })).toEqual({ hash: "ac3f86533e4b5a31" });
  });
  it("takes the mod's files without a hash (the page hashes them as a dropped mod)", () => {
    const files = [{ path: "arr\\units.dat", bytes: new Uint8Array(4) }, { path: "", bytes: new Uint8Array(1) }, { path: "x", bytes: "no" }];
    expect(validReplayDataSet({ name: "Mine", files })).toEqual({ hash: "", name: "Mine", files: [files[0]] });
  });
  it("sends nothing for a hash of another form, or nothing at all", () => {
    expect(validReplayDataSet({ hash: "AC3F86533E4B5A31" })).toBeNull();
    expect(validReplayDataSet({ hash: "ac3f" })).toBeNull();
    expect(validReplayDataSet(undefined)).toBeNull();
    expect(validReplayDataSet(null)).toBeNull();
  });
});
