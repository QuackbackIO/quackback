/**
 * A brand match after it lands: its changes in the parts a person undoes
 * apart (brand, hero, Home and words), the follow-ups that are one known
 * change rather than a new request, and another look from the same match.
 */
import type { AppliedDesignChange, DesignChangeRequest } from './apply-changes'
import { partsChanged } from './step-summary'

export type MatchPart = 'brand' | 'hero' | 'words'

/** Each summary part (step-summary.ts) in the undo part it belongs to. */
const PART_OF: Record<string, MatchPart> = {
  colours: 'brand',
  fonts: 'brand',
  logo: 'brand',
  styles: 'brand',
  hero: 'hero',
  words: 'words',
  layout: 'words',
}

export const MATCH_PART_LABEL: Record<MatchPart, string> = {
  brand: 'Undo brand',
  hero: 'Undo hero',
  words: 'Undo words',
}

/** A match's changes in its undo parts, in order, leaving out a part with none. */
export function matchParts(
  changes: readonly AppliedDesignChange[]
): Array<{ part: MatchPart; changes: AppliedDesignChange[] }> {
  const groups: Record<MatchPart, AppliedDesignChange[]> = { brand: [], hero: [], words: [] }
  for (const change of changes) {
    // Home and its pages go with the words, as turning Home on is said with them.
    const part = /^(nav\.home|pages)\b/.test(change.path)
      ? 'words'
      : (PART_OF[partsChanged([change.path])[0] ?? 'styles'] ?? 'brand')
    groups[part].push(change)
  }
  return (['brand', 'hero', 'words'] as const)
    .filter((part) => groups[part].length > 0)
    .map((part) => ({ part, changes: groups[part] }))
}

/**
 * A follow-up that is one known change, made directly with no new request:
 * the buttons' fill, or the hero calmer or bolder. Null for the rest, which
 * stay requests to Ask AI.
 */
export function chipChange(chip: string): DesignChangeRequest[] | null {
  if (chip === 'Black buttons' || chip === 'White buttons')
    return [{ path: 'shape.fill', value: 'ink' }]
  if (/^[A-Z][\w -]* buttons$/.test(chip)) return [{ path: 'shape.fill', value: 'accent' }]
  if (chip === 'Calmer hero') return [{ path: 'layout.hero', value: 'tint' }]
  if (chip === 'Bolder hero') return [{ path: 'layout.hero', value: 'brand' }]
  return null
}

/** Another look the same match wrote: its words, and how it differs from the draft before the match. */
export interface OtherLook {
  description: string
  changes: AppliedDesignChange[]
}

/**
 * The changes that turn the match into one of its other looks: each field
 * that look set takes its value, and each field only the match or another
 * look set goes back to what it was before the match, so trying one look
 * after another leaves nothing of the first.
 */
export function lookChanges(
  match: readonly AppliedDesignChange[],
  looks: readonly OtherLook[],
  chosen: OtherLook
): DesignChangeRequest[] {
  const set = new Map<string, unknown>()
  for (const change of match)
    if (change.path !== 'brand.matchedAt') set.set(change.path, change.before)
  for (const look of looks)
    for (const change of look.changes)
      if (!set.has(change.path)) set.set(change.path, change.before)
  for (const change of chosen.changes) set.set(change.path, change.after)
  return [...set].map(([path, value]) => ({ path, value }))
}
