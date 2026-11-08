import { describe, expect, it } from "vitest";
import { validDataSet } from "../src/play";

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
