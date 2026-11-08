import { HERO_KEYS } from '../migrations'

type Json = Record<string, unknown>

/**
 * A design as format 2 stored it: version 2, the hero's keys named for the
 * band. For tests of what a design stored before format 3 reads as.
 */
export function asFormat2(doc: object): Json {
  const given = doc as Json
  const out: Json = { ...given, version: 2 }
  for (const [holder, names] of Object.entries(HERO_KEYS)) {
    const renamed = Object.fromEntries(Object.entries(names).map(([old, now]) => [now, old]))
    out[holder] = Object.fromEntries(
      Object.entries(given[holder] as Json).map(([key, value]) => [renamed[key] ?? key, value])
    )
  }
  return out
}
