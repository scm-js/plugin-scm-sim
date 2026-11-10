/**
 * The races a data set adds, as the play page takes them (0.20.0; scm-sim `src/data/races.ts`): a row is an id of
 * 8–255 and a name of 1–40 characters once trimmed, with `letter` (one lower-case letter) and `like` (0, 1 or 2) where
 * they are valid. Invalid rows are left out, never thrown on; the table is sorted by id, the first row of an id kept,
 * and a row's other fields are kept as given.
 */
import type { DataSetRace } from "../contract";

export function validRaces(value: unknown): DataSetRace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>(), out: DataSetRace[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id < 8 || r.id > 255 || seen.has(r.id) || typeof r.name !== "string") continue;
    const name = r.name.trim();
    if (!name || name.length > 40) continue;
    const kept: DataSetRace = { ...r, id: r.id, name };
    if (!(typeof r.letter === "string" && /^[a-z]$/.test(r.letter))) delete kept.letter;
    if (!(r.like === 0 || r.like === 1 || r.like === 2)) delete kept.like;
    seen.add(r.id);
    out.push(kept);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The editor's data set as its races are read: the call of an editor that keeps race names, its profile and source. */
export interface EditorRaces { races?: () => unknown; source(): unknown }

/**
 * The races the editor's data set adds, as Test Map hands them over with it (`profile`: the data set's,
 * `gameData.profile()`): what an editor that keeps race names declares (`gameData.races()`, November 2026), an empty
 * list when it declares none (0.20.1: the names were cleared, and the page must drop the ones it kept); else the
 * profile's (or the source's profile's) list, where an editor keeps them there; nothing from an editor that has
 * neither, which cannot say.
 */
export function editorRaces(gameData: EditorRaces, profile: unknown): { races?: DataSetRace[] } {
  let kept: unknown;
  try { kept = typeof gameData.races === "function" ? gameData.races() : undefined; } catch { kept = undefined; }
  if (Array.isArray(kept)) return racesOf(kept);
  const listed = (p: unknown) => (p && typeof p === "object" ? (p as { races?: unknown }).races : undefined);
  let source: unknown;
  try { source = gameData.source(); } catch { source = null; }
  return racesOf(listed(profile) ?? listed(source && typeof source === "object" ? (source as { profile?: unknown }).profile : undefined));
}

/**
 * `{ races }` to spread into a data set: the valid rows of a list, an empty list among them (0.20.1: the data set adds
 * none, and a page that kept names for it from before drops them), else nothing (not said: a non-list, as from an
 * editor that cannot keep race names, leaves the message as before 0.20.0).
 */
export const racesOf = (value: unknown): { races?: DataSetRace[] } => (Array.isArray(value) ? { races: validRaces(value) } : {});
