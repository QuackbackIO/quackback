/**
 * Workspace search: the record kinds it finds, who may search each one, and
 * how results of different kinds are put in one order.
 *
 * Ranking rule (one list, every kind mixed):
 *
 *   score = titleTier + textScore
 *
 * - titleTier (0 to 3) says how well the title (a person's name or email, a
 *   company's name or domain) matches the whole query, ignoring case:
 *   3 = the same, 2 = starts with it, 1 = contains it, 0 = otherwise.
 * - textScore (0 to just under 1) says how well the text matches: Postgres
 *   ts_rank normalised as rank / (rank + 1) for full-text kinds, or the
 *   meaning similarity (cosine) of a semantic match. People and companies
 *   have no body text, so theirs is 0.
 *
 * A record is a candidate when its text matches the query (full text, or
 * meaning on the results page) or its title contains the query, so `fund`
 * finds "Refund policy" and a title of stop words is still found. The
 * contains-match needs 3 characters or more (trigram indexes cannot narrow
 * a shorter pattern); full text still works for 2-character queries.
 *
 * So a title that matches the query always outranks a body-only match, and
 * text relevance orders results within a tier. Ties go to the most recently
 * updated record, then kind and id, so pages never repeat or skip a row.
 * The tier and text score are computed in SQL (lib/server/domains/assistant/
 * ask-search.ts); this file merges and orders what comes back.
 */
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'

export const SEARCH_KINDS = [
  'post',
  'conversation',
  'ticket',
  'article',
  'changelog',
  'person',
  'teammate',
  'company',
] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export interface SearchResult {
  id: string
  kind: SearchKind
  title: string
  href: string
  /** A short plain-text passage around the first matched word. */
  excerpt?: string
  /** A second line: an email address or a company domain. */
  subtitle?: string
  updatedAt?: string
  /** titleTier + textScore; see the ranking rule above. */
  score: number
}

export interface SearchPage {
  results: SearchResult[]
  hasMore: boolean
}

/** The shortest query that searches records. */
export const MIN_SEARCH_LENGTH = 2
export const MAX_SEARCH_LENGTH = 200
/** Results page size, and how deep pages go before the list stops. */
export const SEARCH_PAGE_SIZE = 20
export const MAX_SEARCH_DEPTH = 100

/**
 * Which kinds this viewer may search: the product must be on and the viewer
 * must hold the permission that opens that kind's page, so every result opens.
 * Articles need none: a teammate who cannot manage the help center still finds
 * the articles their audience may read, linked to the public help center.
 */
export function searchableKinds(
  has: (permission: PermissionKey) => boolean,
  flags: Partial<FeatureFlags> | null | undefined
): SearchKind[] {
  const features = flags ?? {}
  const allowed: Record<SearchKind, boolean> = {
    // Posts and changelog open in admin views that need these permissions.
    post: isProductEnabled(features, 'feedback') && has(PERMISSIONS.POST_VIEW_PRIVATE),
    conversation: !!features.supportInbox && has(PERMISSIONS.CONVERSATION_VIEW),
    ticket: !!features.supportTickets && has(PERMISSIONS.TICKET_VIEW),
    article: isProductEnabled(features, 'helpCenter'),
    changelog: isProductEnabled(features, 'changelog') && has(PERMISSIONS.CHANGELOG_VIEW_DRAFT),
    person: has(PERMISSIONS.PEOPLE_VIEW),
    teammate: has(PERMISSIONS.MEMBER_VIEW),
    company: has(PERMISSIONS.PEOPLE_VIEW) && has(PERMISSIONS.COMPANY_VIEW),
  }
  return SEARCH_KINDS.filter((kind) => allowed[kind])
}

/** Best first: score, then most recently updated, then kind and id. */
export function compareSearchResults(a: SearchResult, b: SearchResult): number {
  return (
    b.score - a.score ||
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
    a.kind.localeCompare(b.kind) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * One ordered list from keyword and semantic matches. A record found both
 * ways keeps its higher score and the first excerpt it was given.
 */
export function mergeSearchResults(...lists: SearchResult[][]): SearchResult[] {
  const byKey = new Map<string, SearchResult>()
  for (const list of lists) {
    for (const result of list) {
      const key = `${result.kind}:${result.id}`
      const seen = byKey.get(key)
      if (!seen) byKey.set(key, result)
      else if (result.score > seen.score)
        byKey.set(key, { ...seen, score: result.score, excerpt: seen.excerpt ?? result.excerpt })
    }
  }
  return [...byKey.values()].sort(compareSearchResults)
}

const EXCERPT_CHARS = 200

/** The words in a query, lowercased: runs of letters and digits. */
export function queryWords(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 10)
}

/**
 * Plain text around the first query word found, so a result shows why it
 * matched. Strips tags and Markdown marks, folds whitespace, and adds an
 * ellipsis where the passage was cut.
 */
export function searchExcerpt(content: string | null | undefined, query: string): string {
  const text = (content ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= EXCERPT_CHARS) return text
  const lower = text.toLowerCase()
  const at = queryWords(query)
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  if (at === undefined || at < EXCERPT_CHARS / 2) return `${text.slice(0, EXCERPT_CHARS).trim()}…`
  const space = text.lastIndexOf(' ', at - 40)
  const start = space < 0 ? 0 : space + 1
  const end = Math.min(text.length, start + EXCERPT_CHARS)
  return `…${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/** The results page for a query, optionally narrowed to one kind. */
export function searchResultsHref(query: string, kind?: SearchKind): string {
  const q = encodeURIComponent(query.trim().slice(0, MAX_SEARCH_LENGTH))
  return `/admin/search?q=${q}${kind ? `&kind=${kind}` : ''}`
}
