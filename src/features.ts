/**
 * What a page of scm-sim's says it does in its `ready` messages (`scmjs.play.ready`, `scmjs.view.ready`, the analysis
 * page's `scmjs.sim.ready`), from scm-sim's R2b on: `features`, names only ever added ("replayDoor": a replay's mod is
 * read and played, switched to or asked for; "liveSwitch": a replay of a mod whose code ran loads the page again with
 * `?lift=live`). A page from before says none.
 */
export const featuresOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((f): f is string => typeof f === "string") : []);
