import { describe, expect, it } from "vitest";
import { simAddress } from "../src/address";

describe("where the engine is", () => {
  it("is beside the editor at scmjs.dev", () => {
    expect(simAddress({ origin: "https://scmjs.dev", hostname: "scmjs.dev", pathname: "/editor/" })).toEqual({ origin: "https://scmjs.dev", play: "https://scmjs.dev/play/", analyse: "https://scmjs.dev/play/analyse.html", view: "https://scmjs.dev/play/?view" });
  });
  it("is beside a stand-in for the site on this machine", () => {
    expect(simAddress({ origin: "http://127.0.0.1:5180", hostname: "127.0.0.1", pathname: "/editor/" })?.analyse).toBe("http://127.0.0.1:5180/play/analyse.html");
    expect(simAddress({ origin: "http://localhost:5174", hostname: "localhost", pathname: "/editor/index.html" })?.play).toBe("http://localhost:5174/play/");
  });
  it("is nowhere for the editor's own dev server, the desktop app and an editor hosted elsewhere", () => {
    expect(simAddress({ origin: "http://localhost:5173", hostname: "localhost", pathname: "/" })).toBeNull();
    expect(simAddress({ origin: "app://scmjs", hostname: "scmjs", pathname: "/index.html" })).toBeNull();
    expect(simAddress({ origin: "https://example.org", hostname: "example.org", pathname: "/editor/" })).toBeNull();
  });
});
