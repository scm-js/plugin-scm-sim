/**
 * Where the engine is. It is another program on the editor's own origin (scm-sim, served
 * at `/play/`), so it exists only where the editor is served beside it: at scmjs.dev, or
 * on a stand-in for the site on one's own machine. The desktop app and an editor hosted
 * elsewhere have no such page.
 */
export interface SimAddress {
  origin: string;
  /** The play page: a game in a tab. */
  play: string;
  /** The analysis page: framed out of sight, plays a replay and answers with a timeline. */
  analyse: string;
  /** The play page as a replay viewer, framed in an element of the editor's (`src/view.ts`). */
  view: string;
}

export function simAddress(at: { origin: string; hostname: string; pathname: string }): SimAddress | null {
  const site = at.origin === "https://scmjs.dev";
  // A stand-in for the site on this machine serves the editor under /editor/ and the play page beside it.
  const local = /^(localhost|127\.0\.0\.1)$/.test(at.hostname) && at.pathname.startsWith("/editor/");
  if (!site && !local) return null;
  return { origin: at.origin, play: `${at.origin}/play/`, analyse: `${at.origin}/play/analyse.html`, view: `${at.origin}/play/?view` };
}

/** What of a replay's data set (`ReplayDataSet`) the page's address names. */
interface AddressedMod { hash: string; live?: boolean }

/**
 * The view's address for a replay played with `dataSet` (0.17.0): `?view` for the game's own data (none, null, or a
 * data set without a hash), `?view&mod=<hash>` for a mod, and `&lift=live` beside it when the mod's code ran (`live`).
 * The view plays the mod its address names and never switches to another; a page from before ignores what it does
 * not know.
 */
export function viewAddress(view: string, dataSet?: AddressedMod | null): string {
  if (!dataSet || !/^[0-9a-f]{16}$/.test(dataSet.hash)) return view;
  return `${view}&mod=${dataSet.hash}${dataSet.live === true ? "&lift=live" : ""}`;
}

/** The play page's address for a replay of a mod whose code ran (`live`): `?lift=live` added; otherwise as it is. */
export function playAddress(play: string, live: boolean): string {
  if (!live) return play;
  const url = new URL(play);
  url.searchParams.set("lift", "live");
  return url.href;
}
