import type { SuggestionListItem, SuggestionGroup } from '../feedback-types'

/**
 * Groups suggestions by their source raw feedback item.
 *
 * - Buckets by `rawItem.id` (null rawItem gets a unique key per suggestion)
 * - Group order preserves first-appearance from the input array
 * - Within each group: `vote_on_post` first, then `create_post`
 */
export function groupSuggestionsBySource(suggestions: SuggestionListItem[]): SuggestionGroup[] {
  const groupMap = new Map<string, SuggestionGroup>()
  const order: string[] = []

  for (const s of suggestions) {
    const key = s.rawItem?.id ?? `__solo_${s.id}`

    let group = groupMap.get(key)
    if (!group) {
      group = { rawItemId: key, rawItem: s.rawItem, suggestions: [] }
      groupMap.set(key, group)
      order.push(key)
    }
    group.suggestions.push(s)
  }

  // Sort within each group: vote_on_post before create_post
  const typeOrder: Record<string, number> = { vote_on_post: 0, create_post: 1, duplicate_post: 2 }
  for (const group of groupMap.values()) {
    group.suggestions.sort(
      (a, b) => (typeOrder[a.suggestionType] ?? 9) - (typeOrder[b.suggestionType] ?? 9)
    )
  }

  return order.map((key) => groupMap.get(key)!)
}
