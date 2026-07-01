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
import type { PostId, ChangelogId, PostStatusId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'
import type {
  EmbedPreview,
  EmbedPostPreview,
  EmbedChangelogPreview,
  EmbedArticlePreview,
} from '@/lib/shared/embeds/types'
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
 * Viewer-scoped resolvers injected into {@link resolveEmbed}. Wired to the real
 * public read paths in the server fn below; replaced with fakes in tests.
 */
export interface EmbedResolverDeps {
  getPostDetail: (id: PostId, actor: Actor) => Promise<PostDetailInput | null>
  listStatuses: () => Promise<readonly StatusInput[]>
  getChangelog: (id: ChangelogId) => Promise<ChangelogInput | null>
  /** Resolve a published, viewer-accessible help-center article by slug. */
  getArticle: (slug: string) => Promise<ArticleInput | null>
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
  kind: 'post' | 'changelog' | 'article',
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
  .validator(z.object({ kind: z.enum(['post', 'changelog', 'article']), id: z.string() }))
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
      ] = await Promise.all([
        import('@/lib/server/domains/posts/post.public.detail'),
        import('@/lib/server/domains/statuses/status.service'),
        import('@/lib/server/domains/changelog/changelog.public'),
        import('@/lib/server/domains/help-center/help-center.article.service'),
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
              return await getPublicArticleBySlug(slug)
            } catch {
              return null
            }
          },
        },
        config.baseUrl
      )
    } catch {
      // Belt-and-braces: portal-access/auth resolution could throw too. A
      // broken embed must never surface an error to the client.
      return { unavailable: true }
    }
  })
