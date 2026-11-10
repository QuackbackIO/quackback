/**
 * Who made each change a draft holds. Each save marks the fields it changed
 * with who saved them, a person or Quackback AI on their behalf; a field
 * changed again takes its newer author. Read against what visitors see, so
 * a change put back drops its author with it.
 */
import { designChanges } from '@/lib/shared/design/diff'
import type { PrincipalId } from '@quackback/ids'

/** A field's dotted path to who changed it last: a principal id, or `ai:` and one. */
export type DraftAuthors = Record<string, string>

/** Who a save is recorded for. */
export function authorKey(principalId: PrincipalId, via?: 'ai'): string {
  return via === 'ai' ? `ai:${principalId}` : principalId
}

/** The authors after a save that turns `before` into `after`. */
export function recordAuthors(
  authors: DraftAuthors | null,
  before: unknown,
  after: unknown,
  author: string
): DraftAuthors {
  const next = { ...authors }
  for (const change of designChanges(before, after)) next[change.path] = author
  return next
}

/** The author of each change the draft still makes against what visitors see. */
export function currentAuthors(
  authors: DraftAuthors | null,
  live: unknown,
  draft: unknown
): DraftAuthors {
  if (!authors) return {}
  const current: DraftAuthors = {}
  for (const change of designChanges(live, draft))
    if (authors[change.path]) current[change.path] = authors[change.path]!
  return current
}
