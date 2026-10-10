import type { ReactNode } from 'react'

export interface QueryHighlightPart {
  text: string
  match: boolean
}

/** Split `text` so every case-insensitive hit of `query` can be styled. */
export function splitQueryHighlights(text: string, query: string): QueryHighlightPart[] {
  const needle = query.trim()
  if (!needle) return [{ text, match: false }]

  const lower = text.toLowerCase()
  const match = needle.toLowerCase()
  const parts: QueryHighlightPart[] = []
  let cursor = 0
  while (cursor < text.length) {
    const hit = lower.indexOf(match, cursor)
    if (hit === -1) {
      parts.push({ text: text.slice(cursor), match: false })
      break
    }
    if (hit > cursor) parts.push({ text: text.slice(cursor, hit), match: false })
    parts.push({ text: text.slice(hit, hit + match.length), match: true })
    cursor = hit + match.length
  }
  return parts
}

/** Slack-style gold on the typed substring; the rest stays the inherited color. */
export function HighlightQuery({ text, query }: { text: string; query: string }): ReactNode {
  const parts = splitQueryHighlights(text, query)
  return parts.map((part, index) =>
    part.match ? (
      <span key={index} data-query-match="" className="text-amber-600 dark:text-amber-400">
        {part.text}
      </span>
    ) : (
      <span key={index}>{part.text}</span>
    )
  )
}

/** Prefer the emoji name when it contains the query (Slack shows `:crossed_fingers:`). */
export function emojiSuggestionLabel(
  item: { name: string; shortcodes: string[] },
  query: string
): string {
  const q = query.trim().toLowerCase()
  const primary = item.shortcodes[0] ?? item.name
  if (!q) return primary
  if (item.name.toLowerCase().includes(q)) return item.name
  const short = item.shortcodes.find((code) => code.toLowerCase().includes(q))
  return short ?? primary
}
