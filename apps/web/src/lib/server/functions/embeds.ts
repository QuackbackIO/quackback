/**
 * Server Function for resolving live link-embed previews.
 *
 * When a Quackback post/changelog URL is embedded in rich text, the display
 * surface resolves it *fresh* through `getEmbedPreviewFn` so the card always
 * shows the current title/votes/status. The resolver is viewer-scoped: it
 * reuses the same public read paths (and the same audience/portal gates) as
 * the portal, so an embed can never surface gated content. Anything the
 * viewer can't see — deleted, unpublished, private, or simply broken —
 * degrades to `{ unavailable: true }`; the handler never throws to the client.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId, ChangelogId, PostStatusId, TicketId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'
import type {
  EmbedPreview,
  EmbedPostPreview,
  EmbedChangelogPreview,
  EmbedArticlePreview,
  EmbedTicketPreview,
} from '@/lib/shared/embeds/types'
import type { TicketType } from '@/lib/shared/db-types'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import { isTeamMember } from '@/lib/shared/roles'
import { formatTicketNumber } from '@/lib/shared/tickets'
import { toIsoStringOrNull } from '@/lib/shared/utils/date'
import { contentPreview } from '@/lib/shared/utils/string'

// ---------------------------------------------------------------------------
// Pure projection + resolve core (no server deps — unit-tested in isolation)
// ---------------------------------------------------------------------------

/** Minimal slice of a public post detail the miniature post card needs. */
type PostDetailInput = {
  id: string
  title: string
  content: string | null
  voteCount: number
  statusId: PostStatusId | null
  board: { name: string; slug: string }
  tags: { id: string; name: string; color: string | null }[]
  authorName: string | null
  authorAvatarUrl: string | null
  createdAt: Date | string | null
}

/** Minimal slice of a public status (the post carries only `statusId`). */
type StatusInput = { id: PostStatusId; name: string; color: string }

/** Minimal slice of a published changelog entry the changelog card needs. */
type ChangelogInput = { id: string; title: string; publishedAt: Date | string | null }

/** Minimal slice of a published help-center article the article card needs. */
type ArticleInput = {
  slug: string
  title: string
  content: string
  description: string | null
  category: { slug: string }
}

/**
 * Enriched ticket slice the embed reader loads before viewer scoping. The
 * status is already projected to its customer-facing stage label + color (never
 * the internal status name), so the projection stays a pure field rename. The
 * scope-only fields (`type`, `requesterPrincipalId`, `deletedAt`) drive
 * {@link scopeTicketEmbed} and are dropped from the viewer-safe preview.
 */
export interface TicketEmbedRow {
  id: string
  number: number
  title: string
  type: TicketType
  requesterPrincipalId: PrincipalId | null
  deletedAt: Date | string | null
  /** The pair's conversation id (converged Messages: a customer ticket's URL
   *  IS its conversation thread). Null for internal ticket types
   *  (back_office/tracker are never conversation-linked). */
  conversationId: string | null
  /** Public stage label (Received / In progress / …), or null when the status
   *  maps to no public stage. Never the internal status name. */
  statusLabel: string | null
  statusColor: string
  priority: ConversationPriority
  createdAt: Date | string | null
}

/**
 * Whether `actor` may see a ticket embed, and (if so) the row to project. The
 * card resolves ONLY for:
 *   - a team member (mirrors how a post embed resolves through the same portal
 *     read path for a teammate viewer), or
 *   - the ticket's own requester on a `customer` ticket — the same ownership
 *     gate `loadOwnedTicketOr404` enforces for the portal ticket page.
 * Everyone else (a different visitor, an anonymous viewer, a requester of some
 * OTHER ticket) gets null → the resolver degrades to "unavailable", leaking no
 * existence. A soft-deleted ticket is unavailable for everyone.
 */
export function scopeTicketEmbed(ticket: TicketEmbedRow, actor: Actor): TicketEmbedRow | null {
  if (ticket.deletedAt) return null
  if (isTeamMember(actor.role)) return ticket
  if (
    ticket.type === 'customer' &&
    actor.principalId != null &&
    ticket.requesterPrincipalId === actor.principalId
  ) {
    return ticket
  }
  return null
}

/**
 * Viewer-scoped resolvers injected into {@link resolveEmbed}. Wired to the real
 * public read paths in the server fn below; replaced with fakes in tests.
 */
export interface EmbedResolverDeps {
  getPostDetail: (id: PostId, actor: Actor) => Promise<PostDetailInput | null>
  listStatuses: () => Promise<readonly StatusInput[]>
  getChangelog: (id: ChangelogId) => Promise<ChangelogInput | null>
  /** Resolve a published, viewer-accessible help-center article by slug. */
  getArticle: (slug: string) => Promise<ArticleInput | null>
  /** Resolve a ticket the viewer may embed (already scoped via
   *  {@link scopeTicketEmbed}), or null when unavailable to this viewer. */
  getTicket: (id: TicketId, actor: Actor) => Promise<TicketEmbedRow | null>
}

/**
 * Project a resolved post detail into the viewer-safe card shape. The post
 * carries only a `statusId`, so the status name/color is looked up from the
 * public status taxonomy; an absent or unknown status yields null fields.
 * `baseUrl` is the canonical portal base, used to build the absolute `url`.
 */
export function projectPostPreview(
  detail: PostDetailInput,
  statuses: readonly StatusInput[],
  baseUrl: string
): EmbedPostPreview {
  const status = detail.statusId ? statuses.find((s) => s.id === detail.statusId) : undefined
  return {
    kind: 'post',
    postId: detail.id,
    title: detail.title,
    excerpt: detail.content ? contentPreview(detail.content, 160) || null : null,
    voteCount: detail.voteCount,
    statusName: status?.name ?? null,
    statusColor: status?.color ?? null,
    boardName: detail.board.name,
    boardSlug: detail.board.slug,
    tags: detail.tags.map((t) => ({ id: t.id, name: t.name, color: t.color ?? null })),
    authorName: detail.authorName,
    authorAvatarUrl: detail.authorAvatarUrl,
    createdAt: toIsoStringOrNull(detail.createdAt),
    url: joinBase(baseUrl, `/b/${detail.board.slug}/posts/${detail.id}`),
  }
}

/** Project a published changelog entry into the viewer-safe card shape. */
export function projectChangelogPreview(
  entry: ChangelogInput,
  baseUrl: string
): EmbedChangelogPreview {
  return {
    kind: 'changelog',
    entryId: entry.id,
    title: entry.title,
    publishedAt: toIsoStringOrNull(entry.publishedAt),
    url: joinBase(baseUrl, `/changelog/${entry.id}`),
  }
}

/**
 * Project a published help-center article into the viewer-safe article card
 * shape. The excerpt uses the article body text first, falling back to the
 * optional description field; both are trimmed to 160 chars.
 * `baseUrl` is the canonical portal base, used to build the absolute `url`.
 */
export function projectArticlePreview(article: ArticleInput, baseUrl: string): EmbedArticlePreview {
  const rawText = article.content || article.description || ''
  const excerpt = rawText ? contentPreview(rawText, 160) || null : null
  return {
    kind: 'article',
    articleId: article.slug,
    categorySlug: article.category.slug,
    title: article.title,
    excerpt,
    url: joinBase(baseUrl, `/hc/articles/${article.category.slug}/${article.slug}`),
  }
}

/**
 * Project a viewer-scoped ticket row into the customer-safe card shape. The
 * `reference` is the formatted sequential number and `url` is the absolute
 * portal ticket page (opened in a new tab from the widget). `baseUrl` is the
 * canonical portal base.
 */
export function projectTicketPreview(ticket: TicketEmbedRow, baseUrl: string): EmbedTicketPreview {
  return {
    kind: 'ticket',
    ticketId: ticket.id,
    conversationId: ticket.conversationId,
    reference: formatTicketNumber(ticket.number),
    title: ticket.title,
    statusLabel: ticket.statusLabel,
    statusColor: ticket.statusColor,
    priority: ticket.priority,
    createdAt: toIsoStringOrNull(ticket.createdAt),
    // Converged Messages: a customer ticket's URL is the pair's conversation
    // thread. Internal ticket types (no conversation; teammate-only viewers
    // per scopeTicketEmbed) link the admin inbox instead.
    url: joinBase(
      baseUrl,
      ticket.conversationId ? `/support/${ticket.conversationId}` : `/admin/inbox?i=${ticket.id}`
    ),
  }
}

/** Join a base URL and an absolute path, collapsing any trailing slash on the
 *  base so `${base}/path` never doubles up (`config.baseUrl` may or may not
 *  carry one). */
function joinBase(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`
}

/**
 * Resolve an embed reference to a preview using the injected resolvers. Any
 * null (not found / not viewable) or thrown error (the post path may throw a
 * NotFoundError for gated posts) collapses to `{ unavailable: true }` so no
 * exception ever escapes and no gated data leaks.
 */
export async function resolveEmbed(
  kind: 'post' | 'changelog' | 'article' | 'ticket',
  id: string,
  actor: Actor,
  deps: EmbedResolverDeps,
  baseUrl: string
): Promise<EmbedPreview> {
  try {
    if (kind === 'post') {
      const detail = await deps.getPostDetail(id as PostId, actor)
      if (!detail) return { unavailable: true }
      const statuses = await deps.listStatuses()
      return projectPostPreview(detail, statuses, baseUrl)
    }
    if (kind === 'article') {
      const article = await deps.getArticle(id)
      if (!article) return { unavailable: true }
      return projectArticlePreview(article, baseUrl)
    }
    if (kind === 'ticket') {
      const ticket = await deps.getTicket(id as TicketId, actor)
      if (!ticket) return { unavailable: true }
      return projectTicketPreview(ticket, baseUrl)
    }
    const entry = await deps.getChangelog(id as ChangelogId)
    if (!entry) return { unavailable: true }
    return projectChangelogPreview(entry, baseUrl)
  } catch {
    return { unavailable: true }
  }
}

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const getEmbedPreviewFn = createServerFn({ method: 'GET' })
  .validator(z.object({ kind: z.enum(['post', 'changelog', 'article', 'ticket']), id: z.string() }))
  .handler(async ({ data }): Promise<EmbedPreview> => {
    try {
      // Outer gate: a private portal serves no embed preview to a denied caller
      // (mirrors fetchPublicPostDetail / getPublicChangelogFn).
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) return { unavailable: true }

      // Same actor-resolution path as the portal reads — drives the per-board
      // audience check inside getPublicPostDetail.
      const { getOptionalAuth, policyActorFromAuth } = await import('./auth-helpers')
      const actor = await policyActorFromAuth(await getOptionalAuth())

      const [
        { getPublicPostDetail },
        { listPublicStatuses },
        { getPublicChangelogMetaById },
        { getPublicArticleBySlug },
        { getTicketEmbedForViewer },
      ] = await Promise.all([
        import('@/lib/server/domains/posts/post.public.detail'),
        import('@/lib/server/domains/statuses/status.service'),
        import('@/lib/server/domains/changelog/changelog.public'),
        import('@/lib/server/domains/help-center/help-center.article.service'),
        import('@/lib/server/domains/tickets/ticket-embed.service'),
      ])

      // Canonical portal base for the absolute embed `url` (opened in a new tab
      // by surfaces like the widget). Imported lazily alongside the read paths.
      const { config } = await import('@/lib/server/config')

      // Article resolver: `getPublicArticleBySlug` throws NotFoundError when the
      // article is absent, private, or unpublished — the catch in `resolveEmbed`
      // collapses that to `{ unavailable: true }` without leaking the error.
      return await resolveEmbed(
        data.kind,
        data.id,
        actor,
        {
          getPostDetail: getPublicPostDetail,
          listStatuses: listPublicStatuses,
          getChangelog: getPublicChangelogMetaById,
          getArticle: async (slug: string) => {
            try {
              // The actor drives the category segment gate: a gated article
              // embeds as unavailable for non-members, same as a missing one.
              return await getPublicArticleBySlug(slug, actor)
            } catch {
              return null
            }
          },
          // Viewer-scoped inside the service (team member OR the ticket's own
          // requester); a ticket this viewer can't see resolves to null →
          // "unavailable", never leaking that the ticket exists.
          getTicket: getTicketEmbedForViewer,
        },
        config.baseUrl
      )
    } catch {
      // Belt-and-braces: portal-access/auth resolution could throw too. A
      // broken embed must never surface an error to the client.
      return { unavailable: true }
    }
  })
