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

/** `{ races }` to spread into a data set when there are valid rows, else nothing (the message as before 0.20.0). */
export const racesOf = (value: unknown): { races?: DataSetRace[] } => { const races = validRaces(value); return races.length ? { races } : {}; };
