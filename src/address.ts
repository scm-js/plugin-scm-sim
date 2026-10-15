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
