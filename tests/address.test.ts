import { describe, expect, it } from "vitest";
import { playAddress, simAddress, viewAddress } from "../src/address";

describe("where the engine is", () => {
  it("is beside the editor at scmjs.dev", () => {
    expect(simAddress({ origin: "https://scmjs.dev", hostname: "scmjs.dev", pathname: "/editor/" })).toEqual({ origin: "https://scmjs.dev", play: "https://scmjs.dev/play/", analyse: "https://scmjs.dev/play/analyse.html", view: "https://scmjs.dev/play/?view" });
  });
  it("is beside a stand-in for the site on this machine", () => {
    expect(simAddress({ origin: "http://127.0.0.1:5180", hostname: "127.0.0.1", pathname: "/editor/" })?.analyse).toBe("http://127.0.0.1:5180/play/analyse.html");
    expect(simAddress({ origin: "http://localhost:5174", hostname: "localhost", pathname: "/editor/index.html" })?.play).toBe("http://localhost:5174/play/");
  });
  it("names a replay's mod in the view's address, with its live lifter when its code ran (0.17.0)", () => {
    const view = "https://scmjs.dev/play/?view";
    expect(viewAddress(view, { hash: "ac3f86533e4b5a31", live: true })).toBe("https://scmjs.dev/play/?view&mod=ac3f86533e4b5a31&lift=live");
    expect(viewAddress(view, { hash: "ac3f86533e4b5a31" })).toBe("https://scmjs.dev/play/?view&mod=ac3f86533e4b5a31");
    expect(viewAddress(view, null)).toBe(view);
    expect(viewAddress(view)).toBe(view);
    expect(viewAddress(view, { hash: "", live: true })).toBe(view);
    expect(viewAddress(view, { hash: "AC3F86533E4B5A31" })).toBe(view);
  });
  it("opens the play page with ?lift=live for a replay whose mod's code ran", () => {
    expect(playAddress("https://scmjs.dev/play/", true)).toBe("https://scmjs.dev/play/?lift=live");
    expect(playAddress("https://scmjs.dev/play/", false)).toBe("https://scmjs.dev/play/");
    expect(playAddress("https://scmjs.dev/play/?mod=ac3f86533e4b5a31&lift=x", true)).toBe("https://scmjs.dev/play/?mod=ac3f86533e4b5a31&lift=live");
  });
  it("is nowhere for the editor's own dev server, the desktop app and an editor hosted elsewhere", () => {
    expect(simAddress({ origin: "http://localhost:5173", hostname: "localhost", pathname: "/" })).toBeNull();
    expect(simAddress({ origin: "app://scmjs", hostname: "scmjs", pathname: "/index.html" })).toBeNull();
    expect(simAddress({ origin: "https://example.org", hostname: "example.org", pathname: "/editor/" })).toBeNull();
  });
});
