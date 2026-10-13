export interface AskEntityResult {
  id: string
  kind: 'post' | 'article' | 'changelog' | 'conversation' | 'ticket'
  title: string
  href: string
  excerpt?: string
  updatedAt?: string
  score?: number
}

export const ASK_ENTITY_KINDS = ['post', 'conversation', 'ticket', 'article', 'changelog'] as const
export type AskEntityKind = (typeof ASK_ENTITY_KINDS)[number]

export function searchExcerpt(content: string | null | undefined): string {
  return (content ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}
