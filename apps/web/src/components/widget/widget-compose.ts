import type { JSONContent } from '@tiptap/core'
import { generateContentHTML } from '@/lib/shared/content-html'
import { isArticleTypeId } from '@/lib/shared/widget/article-ref'
import { homeEnabled, type EnabledTabs } from './widget-nav'

export { isArticleTypeId }

export interface WidgetComposeRequest {
  /** Bumped on every programmatic open so the same title/board can re-apply. */
  nonce: number
  title?: string
  body?: string
  boardSlug?: string
}

export type WidgetOpenPayload = {
  view?: string
  title?: string
  body?: string
  board?: string
  query?: string
  entryId?: string
  postId?: string
  articleId?: string
}

export type WidgetOpenCommand =
  | { type: 'new-post'; title?: string; body?: string; boardSlug?: string }
  | { type: 'post'; postId: string }
  | { type: 'article'; articleId: string } // slug or `article_` TypeID (`kb_article_` still accepted)
  | { type: 'changelog'; entryId?: string }
  | { type: 'help'; query?: string }
  | { type: 'messenger' }
  | { type: 'tickets' }
  | { type: 'messages' }
  | { type: 'home' }

/**
 * Map an SDK `open(...)` payload to an iframe command. Unknown or unauthorized
 * targets return null — the panel is already open; do not invent a surface.
 *
 * `postId` and `articleId` win over `view` so a deep-link is never swallowed
 * by a leftover compose/home view on the same payload.
 */
export function resolveOpenCommand(
  opts: WidgetOpenPayload,
  tabs: EnabledTabs
): WidgetOpenCommand | null {
  if (nonEmpty(opts.postId)) {
    return tabs.feedback ? { type: 'post', postId: opts.postId } : null
  }
  if (nonEmpty(opts.articleId)) {
    return tabs.help ? { type: 'article', articleId: opts.articleId } : null
  }

  switch (opts.view) {
    case 'new-post':
      if (!tabs.feedback) return null
      return {
        type: 'new-post',
        title: emptyToUndef(opts.title),
        body: emptyToUndef(opts.body),
        boardSlug: emptyToUndef(opts.board),
      }
    case 'changelog':
      if (!tabs.changelog) return null
      return { type: 'changelog', entryId: emptyToUndef(opts.entryId) }
    case 'help':
      if (!tabs.help) return null
      return { type: 'help', query: emptyToUndef(opts.query) }
    case 'messages':
    case 'chat':
    case 'live-chat':
      return tabs.messages ? { type: 'messenger' } : null
    case 'tickets':
      if (tabs.tickets) return { type: 'tickets' }
      if (tabs.messages) return { type: 'messages' }
      return null
    case 'home':
    case 'overview':
    case undefined:
      return homeEnabled(tabs) ? { type: 'home' } : null
    default:
      return null
  }
}

/**
 * Resolve a compose-form board. Only slugs already on the visitor-visible
 * `boards` list (boardViewFilter) can win — never invent access. An unknown
 * or omitted slug uses the same fallback as a normal form mount: configured
 * default, else the only board, else empty (picker).
 */
export function resolveComposeBoardId(
  boards: ReadonlyArray<{ id: string; slug: string }>,
  requestedSlug: string | undefined,
  defaultBoardSlug: string | undefined
): string {
  if (requestedSlug) {
    const requested = boards.find((b) => b.slug === requestedSlug)
    if (requested) return requested.id
  }
  if (defaultBoardSlug) {
    const fallback = boards.find((b) => b.slug === defaultBoardSlug)
    if (fallback) return fallback.id
  }
  if (boards.length === 1) return boards[0].id
  return ''
}

/** Drop a Popular Ideas filter the current session can no longer see. */
export function shouldClearInvisibleBoardFilter(
  activeBoardSlug: string | null,
  confirmedBoardSlugs: readonly string[] | null | undefined
): boolean {
  return (
    !!activeBoardSlug && !!confirmedBoardSlugs && !confirmedBoardSlugs.includes(activeBoardSlug)
  )
}

/** Re-apply `open({ board })` only when identify just granted that slug. */
export function shouldReapplyComposeBoard(
  requestedSlug: string | undefined,
  previousSlugs: ReadonlySet<string>,
  nextSlugs: ReadonlySet<string>
): boolean {
  if (!requestedSlug) return false
  return nextSlugs.has(requestedSlug) && !previousSlugs.has(requestedSlug)
}

/** Plain-text `body` from the host → a one-paragraph-per-line TipTap doc. */
export function composeBodyFromPlainText(body: string): { json: JSONContent; html: string } {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const json: JSONContent = {
    type: 'doc',
    content:
      lines.length === 0
        ? [{ type: 'paragraph' }]
        : lines.map((line) => ({
            type: 'paragraph',
            ...(line ? { content: [{ type: 'text', text: line }] } : {}),
          })),
  }
  return { json, html: generateContentHTML(json) }
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function emptyToUndef(value: string | undefined): string | undefined {
  return nonEmpty(value) ? value : undefined
}
