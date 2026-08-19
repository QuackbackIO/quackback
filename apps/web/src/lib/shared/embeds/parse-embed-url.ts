import { isValidTypeId } from '@quackback/ids'

/**
 * A parsed reference to an embeddable Quackback entity. Produced by
 * {@link parseEmbedUrl} when a pasted/typed URL points at a feedback post,
 * a published changelog entry, or a help-center article; consumed by the
 * embed resolver/card.
 */
export type EmbedRef = { kind: 'post' | 'changelog' | 'article' | 'ticket'; id: string }

// Help-center article slugs: lowercase alphanumeric, hyphens only, max 300 chars
// (mirrors `slugify()` in shared/utils/string). Article embeds key on the slug,
// not a TypeID — so this is the validity check the sanitizer AND the display-time
// hydration use for `kind: 'article'`, just as they use isValidTypeId for the rest.
export const ARTICLE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,299}$/
export function isValidArticleSlug(id: string): boolean {
  return ARTICLE_SLUG_RE.test(id)
}

// Path shapes we recognise. The captured segment is the candidate identifier.
//   - post:      /b/<board-slug>/posts/<post-id>               → TypeID (validated)
//   - changelog: /changelog/<changelog-id>                     → TypeID (validated)
//   - article:   /hc/articles/<category-slug>/<article-slug>   → slug (pattern-checked)
//   - ticket:    /support/ticket/<ticket-id>                   → TypeID (validated)
// Note the changelog prefix is `changelog_` (per @quackback/ids ID_PREFIXES), not `clog_`.
// Article public URLs are slug-based, not TypeID-based, so the captured group is
// the article slug; validity is checked against the slug charset below.
const POST_PATH = /^\/b\/[^/]+\/posts\/(post_[0-9a-z]+)$/i
const CHANGELOG_PATH = /^\/changelog\/(changelog_[0-9a-z]+)$/i
const ARTICLE_PATH = /^\/hc\/articles\/[^/]+\/([a-z0-9][a-z0-9-]*)$/i
const TICKET_PATH = /^\/support\/ticket\/(ticket_[0-9a-z]+)$/i

// Full-URL matchers for paste rules (TipTap's `nodePasteRule` runs these against
// the whole pasted text, not just a pathname). They mirror the same `post_` /
// `changelog_` prefixes as the path regexes above — kept here so the editor node
// and the parser share a single prefix source. The captured group is the TypeID;
// the global flag is required by `nodePasteRule`. Validity (charset + round-trip)
// is enforced downstream, so these stay deliberately permissive.
export const POST_URL_PASTE_RE = /https?:\/\/[^\s]+\/b\/[^/\s]+\/posts\/(post_[0-9a-z]+)\b/gi
export const CHANGELOG_URL_PASTE_RE = /https?:\/\/[^\s]+\/changelog\/(changelog_[0-9a-z]+)\b/gi
// Article paste rule captures the article slug (second segment after /hc/articles/).
// The path /hc/articles/{categorySlug}/{articleSlug} is unambiguous — no other
// entity lives under that two-segment prefix.
export const ARTICLE_URL_PASTE_RE =
  /https?:\/\/[^\s]+\/hc\/articles\/[^/\s]+\/([a-z0-9][a-z0-9-]*)\b/gi
// Ticket paste rule captures the ticket TypeID. Portal ticket pages live at the
// single `/support/ticket/<id>` path — the resolver viewer-scopes the card, so a
// pasted link only ever renders for the ticket's requester or a teammate.
export const TICKET_URL_PASTE_RE = /https?:\/\/[^\s]+\/support\/ticket\/(ticket_[0-9a-z]+)\b/gi

/**
 * Parse a Quackback URL into a typed embed reference, or `null` when the URL
 * is malformed, points elsewhere, or carries an id that isn't a valid TypeID
 * of the expected kind. Never throws — an unparseable string is just `null`.
 */
export function parseEmbedUrl(raw: string): EmbedRef | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const postMatch = url.pathname.match(POST_PATH)
  if (postMatch && isValidTypeId(postMatch[1], 'post')) {
    return { kind: 'post', id: postMatch[1] }
  }

  const changelogMatch = url.pathname.match(CHANGELOG_PATH)
  if (changelogMatch && isValidTypeId(changelogMatch[1], 'changelog')) {
    return { kind: 'changelog', id: changelogMatch[1] }
  }

  const articleMatch = url.pathname.match(ARTICLE_PATH)
  if (articleMatch) {
    return { kind: 'article', id: articleMatch[1] }
  }

  const ticketMatch = url.pathname.match(TICKET_PATH)
  if (ticketMatch && isValidTypeId(ticketMatch[1], 'ticket')) {
    return { kind: 'ticket', id: ticketMatch[1] }
  }

  return null
}
