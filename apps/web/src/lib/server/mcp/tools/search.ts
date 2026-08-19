/**
 * Cross-entity lookup tools: `search` and `get_details`.
 *
 * Both dispatch on their arguments (entity kind / TypeID prefix), so they gate
 * per-branch in the handler with requireScope / requireTeamRole rather than
 * declaring a single scope on registerTool.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { getPostWithDetails, getCommentsWithReplies } from '@/lib/server/domains/posts/post.query'
import { getMergedPosts } from '@/lib/server/domains/posts/post.merge'
import { getChangelogById } from '@/lib/server/domains/changelog/changelog.service'
import { listChangelogs } from '@/lib/server/domains/changelog/changelog.query'
import {
  listArticles,
  getArticleById,
  getCategoryById,
} from '@/lib/server/domains/help-center/help-center.service'
import { getTypeIdPrefix } from '@quackback/ids'
import { truncate } from '@/lib/shared/utils/string'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type {
  PostId,
  BoardId,
  PostTagId,
  ChangelogId,
  KbArticleId,
  KbCategoryId,
} from '@quackback/ids'
import type { McpAuthContext } from '../types'
import {
  registerTool,
  requireScope,
  requireTeamRole,
  requireHelpCenter,
  jsonResult,
  compactJsonResult,
  errorResult,
  encodeSearchCursor,
  decodeSearchCursor,
  articleResult,
  categoryResult,
  READ_ONLY,
} from './helpers'

// ============================================================================
// Schemas
// ============================================================================

const searchSchema = {
  entity: z
    .enum(['posts', 'changelogs', 'articles'])
    .default('posts')
    .describe('Entity type to search. Defaults to posts.'),
  query: z.string().optional().describe('Text search across titles and content'),
  boardId: z.string().optional().describe('Filter posts by board TypeID (ignored for changelogs)'),
  categoryId: z
    .string()
    .optional()
    .describe('Filter articles by category TypeID (ignored for posts and changelogs)'),
  status: z
    .string()
    .optional()
    .describe(
      'Filter by status. For posts: slug like "open", "in_progress". For changelogs: "draft", "published", "scheduled", "all". For articles: "draft", "published", "all".'
    ),
  tagIds: z
    .array(z.string())
    .optional()
    .describe('Filter posts by tag TypeIDs (ignored for changelogs)'),
  sort: z
    .enum(['newest', 'oldest', 'votes'])
    .default('newest')
    .describe('Sort order. "votes" only applies to posts.'),
  showDeleted: z
    .boolean()
    .default(false)
    .describe('Show only soft-deleted posts instead of active ones (team only, last 30 days)'),
  dateFrom: z
    .string()
    .optional()
    .describe(
      'ISO 8601 date string for filtering posts created on or after this date (e.g. "2024-06-01")'
    ),
  dateTo: z
    .string()
    .optional()
    .describe(
      'ISO 8601 date string for filtering posts created on or before this date (e.g. "2024-06-30")'
    ),
  limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
}

const getDetailsSchema = {
  id: z
    .string()
    .describe(
      'TypeID of the entity to fetch (e.g., post_01abc..., changelog_01xyz...). Entity type is auto-detected from the prefix.'
    ),
}

// ============================================================================
// Type aliases — manually defined to avoid deep Zod type recursion.
// WARNING: These must stay in sync with the Zod schemas above.
// If you add/remove/rename a field in a schema, update the matching type here.
// ============================================================================

type SearchArgs = {
  entity: 'posts' | 'changelogs' | 'articles'
  query?: string
  boardId?: string
  categoryId?: string
  status?: string
  tagIds?: string[]
  dateFrom?: string
  dateTo?: string
  showDeleted: boolean
  sort: 'newest' | 'oldest' | 'votes'
  limit: number
  cursor?: string
}

type GetDetailsArgs = { id: string }

// ============================================================================
// Tool registration
// ============================================================================

export function registerSearchTools(server: McpServer, auth: McpAuthContext) {
  registerTool<SearchArgs>(server, auth, {
    name: 'search',
    description: `Search feedback posts, changelog entries, or help center articles. Returns paginated results with a cursor for fetching more.

Examples:
- Search all posts: search()
- Search by text: search({ query: "dark mode" })
- Filter by board and status: search({ boardId: "board_01abc...", status: "open" })
- Search changelogs: search({ entity: "changelogs", status: "published" })
- Search articles: search({ entity: "articles", query: "getting started" })
- Filter articles by category: search({ entity: "articles", categoryId: "kb_category_01abc..." })
- Sort by votes: search({ sort: "votes", limit: 10 })`,
    schema: searchSchema,
    annotations: READ_ONLY,
    handler: async (args) => {
      if (args.entity === 'articles') {
        const flagDenied = await requireHelpCenter()
        if (flagDenied) return flagDenied
        const denied = requireScope(auth, 'read:article')
        if (denied) return denied
        // Help-center MCP read surfaces unpublished drafts and articles
        // under categories an admin marked private. The public help
        // center site already serves the published+isPublic slice for
        // anonymous and portal users; gating MCP read on team role
        // matches the team-only intent of the inbox-style tools.
        const roleDenied = requireTeamRole(auth)
        if (roleDenied) return roleDenied
        return searchArticles(args)
      }

      const denied = requireScope(auth, 'read:feedback')
      if (denied) return denied
      // Posts and changelogs inbox-style listings expose pending /
      // soft-deleted / draft / scheduled content alongside published
      // rows. Gating these on team role keeps OAuth portal users out
      // of the admin moderation surface.
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      if (args.entity === 'changelogs') {
        return searchChangelogs(args)
      }
      return searchPosts(args)
    },
  })

  registerTool<GetDetailsArgs>(server, auth, {
    name: 'get_details',
    description: `Get full details for any entity by TypeID. Entity type is auto-detected from the ID prefix.

Examples:
- Get a post: get_details({ id: "post_01abc..." })
- Get a changelog: get_details({ id: "changelog_01xyz..." })
- Get an article: get_details({ id: "kb_article_01abc..." })
- Get a category: get_details({ id: "kb_category_01abc..." })`,
    schema: getDetailsSchema,
    annotations: READ_ONLY,
    handler: async (args) => {
      // Per-branch error mapping: an unparseable TypeID gets a format hint
      // rather than the generic errorResult wrapping.
      let prefix: string
      try {
        prefix = getTypeIdPrefix(args.id)
      } catch {
        return errorResult(
          new Error(
            `Invalid TypeID format: "${args.id}". Expected format: prefix_base32suffix (e.g., post_01abc..., kb_article_01abc...)`
          )
        )
      }

      switch (prefix) {
        case 'post': {
          const denied = requireScope(auth, 'read:feedback')
          if (denied) return denied
          // Posts here surface moderation/inbox fields (deletedAt,
          // moderationState, pinnedCommentId, summaryJson...). Gate to
          // team — portal users should hit the public portal API.
          const roleDenied = requireTeamRole(auth)
          if (roleDenied) return roleDenied
          return getPostDetails(args.id as PostId)
        }
        case 'changelog': {
          const denied = requireScope(auth, 'read:feedback')
          if (denied) return denied
          // get_details returns the raw entry including drafts /
          // scheduled rows. Team-only matches the search gate.
          const roleDenied = requireTeamRole(auth)
          if (roleDenied) return roleDenied
          return getChangelogDetails(args.id as ChangelogId)
        }
        case 'kb_article': {
          const flagDenied = await requireHelpCenter()
          if (flagDenied) return flagDenied
          const denied = requireScope(auth, 'read:article')
          if (denied) return denied
          // getArticleById doesn't enforce publishedAt or
          // category.isPublic — so a portal user with the help-center
          // OAuth scope could fetch drafts or private-category
          // articles. The public help-center site has its own
          // unauthenticated path for the published slice.
          const roleDenied = requireTeamRole(auth)
          if (roleDenied) return roleDenied
          return getArticleDetails(args.id as KbArticleId)
        }
        case 'kb_category': {
          const flagDenied = await requireHelpCenter()
          if (flagDenied) return flagDenied
          const denied = requireScope(auth, 'read:article')
          if (denied) return denied
          // getCategoryById returns private categories too — keep
          // symmetric with the article path.
          const roleDenied = requireTeamRole(auth)
          if (roleDenied) return roleDenied
          return getCategoryDetails(args.id as KbCategoryId)
        }
        default:
          return errorResult(
            new Error(
              `Unsupported entity type: "${prefix}". Supported: post, changelog, kb_article, kb_category`
            )
          )
      }
    },
  })
}

// ============================================================================
// Search dispatchers
// ============================================================================

async function searchPosts(args: SearchArgs): Promise<CallToolResult> {
  const decoded = decodeSearchCursor(args.cursor)
  // Reject cursors from a different entity
  if (args.cursor && decoded.entity && decoded.entity !== 'posts') {
    return errorResult(
      new Error('Cursor is from a different entity type. Do not reuse cursors across entity types.')
    )
  }
  // The cursor value is a PostId string from the previous page's last item
  const cursorValue = typeof decoded.value === 'string' ? decoded.value : undefined

  const result = await listInboxPosts({
    search: args.query,
    boardIds: args.boardId ? [args.boardId as BoardId] : undefined,
    statusSlugs: args.status ? [args.status] : undefined,
    tagIds: args.tagIds as PostTagId[] | undefined,
    dateFrom: args.dateFrom ? new Date(args.dateFrom) : undefined,
    dateTo: (() => {
      if (!args.dateTo) return undefined
      const d = new Date(args.dateTo)
      // Treat date-only dateTo (e.g. "2024-06-30") as end-of-day so the full day is included
      if (/^\d{4}-\d{2}-\d{2}$/.test(args.dateTo)) d.setUTCHours(23, 59, 59, 999)
      return d
    })(),
    showDeleted: args.showDeleted || undefined,
    sort: args.sort,
    cursor: cursorValue,
    limit: args.limit,
  })

  // Encode nextCursor with entity type to prevent cross-entity misuse
  const lastItem = result.items[result.items.length - 1]
  const nextCursor = result.hasMore && lastItem ? encodeSearchCursor('posts', lastItem.id) : null

  return compactJsonResult({
    posts: result.items.map((p) => ({
      id: p.id,
      title: p.title,
      excerpt: p.content ? truncate(p.content, 200) : '',
      voteCount: p.voteCount,
      commentCount: p.commentCount,
      boardId: p.boardId,
      boardName: p.board?.name,
      statusId: p.statusId,
      authorName: p.authorName,
      ownerPrincipalId: p.ownerPrincipalId,
      tags: p.tags?.map((t) => ({ id: t.id, name: t.name })),
      summary: p.summaryJson?.summary ?? null,
      canonicalPostId: p.canonicalPostId ?? null,
      isCommentsLocked: p.isCommentsLocked,
      createdAt: p.createdAt,
      deletedAt: p.deletedAt ?? null,
    })),
    nextCursor,
    hasMore: result.hasMore,
  })
}

async function searchChangelogs(args: SearchArgs): Promise<CallToolResult> {
  const decoded = decodeSearchCursor(args.cursor)
  // Reject cursors from a different entity
  if (args.cursor && decoded.entity && decoded.entity !== 'changelogs') {
    return errorResult(
      new Error('Cursor is from a different entity type. Do not reuse cursors across entity types.')
    )
  }
  const cursorValue = typeof decoded.value === 'string' ? decoded.value : undefined

  // Map status param — changelogs support draft/published/scheduled/all
  const validStatuses = new Set(['draft', 'published', 'scheduled', 'all'])
  const status = validStatuses.has(args.status ?? '')
    ? (args.status as 'draft' | 'published' | 'scheduled' | 'all')
    : undefined

  const result = await listChangelogs({
    status,
    cursor: cursorValue,
    limit: args.limit,
  })

  // Encode next cursor using the last item's ID
  const lastItem = result.items[result.items.length - 1]
  const nextCursor =
    result.hasMore && lastItem ? encodeSearchCursor('changelogs', lastItem.id) : null

  return compactJsonResult({
    changelogs: result.items.map((c) => ({
      id: c.id,
      title: c.title,
      excerpt: c.content ? truncate(c.content, 200) : '',
      status: c.status,
      authorName: c.author?.name ?? null,
      linkedPosts: c.linkedPosts.map((p) => ({
        id: p.id,
        title: p.title,
        voteCount: p.voteCount,
      })),
      publishedAt: c.publishedAt,
      displayDate: c.displayDate,
      createdAt: c.createdAt,
    })),
    nextCursor,
    hasMore: result.hasMore,
  })
}

async function searchArticles(args: SearchArgs): Promise<CallToolResult> {
  const decoded = decodeSearchCursor(args.cursor)
  if (args.cursor && decoded.entity && decoded.entity !== 'articles') {
    return errorResult(
      new Error('Cursor is from a different entity type. Do not reuse cursors across entity types.')
    )
  }
  const cursorValue = typeof decoded.value === 'string' ? decoded.value : undefined

  const validStatuses = new Set(['draft', 'published', 'all'])
  const status = validStatuses.has(args.status ?? '')
    ? (args.status as 'draft' | 'published' | 'all')
    : undefined

  const result = await listArticles({
    categoryId: args.categoryId,
    status,
    search: args.query,
    cursor: cursorValue,
    limit: args.limit,
  })

  const lastItem = result.items[result.items.length - 1]
  const nextCursor = result.hasMore && lastItem ? encodeSearchCursor('articles', lastItem.id) : null

  return compactJsonResult({
    articles: result.items.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      excerpt: a.content ? truncate(a.content, 200) : '',
      description: a.description,
      status: a.publishedAt ? 'published' : 'draft',
      categoryId: a.category.id,
      categoryName: a.category.name,
      categorySlug: a.category.slug,
      authorName: a.author?.name ?? null,
      publishedAt: a.publishedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    nextCursor,
    hasMore: result.hasMore,
  })
}

// ============================================================================
// Get details dispatchers
// ============================================================================

async function getPostDetails(postId: PostId): Promise<CallToolResult> {
  const [post, comments, mergedPosts] = await Promise.all([
    getPostWithDetails(postId),
    getCommentsWithReplies(postId),
    getMergedPosts(postId),
  ])

  return jsonResult({
    id: post.id,
    title: post.title,
    content: contentJsonToMarkdown(post.contentJson, post.content),
    voteCount: post.voteCount,
    commentCount: post.commentCount,
    boardId: post.boardId,
    boardName: post.board?.name,
    boardSlug: post.board?.slug,
    statusId: post.statusId,
    authorName: post.authorName,
    ownerPrincipalId: post.ownerPrincipalId,
    tags: post.tags?.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    pinnedComment: post.pinnedComment
      ? {
          id: post.pinnedComment.id,
          content: post.pinnedComment.content,
          authorName: post.pinnedComment.authorName,
          createdAt: post.pinnedComment.createdAt,
        }
      : null,
    summaryJson: post.summaryJson ?? null,
    summaryUpdatedAt: post.summaryUpdatedAt ?? null,
    canonicalPostId: post.canonicalPostId ?? null,
    mergedAt: post.mergedAt ?? null,
    isCommentsLocked: post.isCommentsLocked,
    mergedPosts: mergedPosts.map((mp) => ({
      id: mp.id,
      title: mp.title,
      voteCount: mp.voteCount,
      authorName: mp.authorName,
      mergedAt: mp.mergedAt,
    })),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    deletedAt: post.deletedAt ?? null,
    comments,
  })
}

async function getChangelogDetails(changelogId: ChangelogId): Promise<CallToolResult> {
  const entry = await getChangelogById(changelogId)

  return jsonResult({
    id: entry.id,
    title: entry.title,
    content: contentJsonToMarkdown(entry.contentJson, entry.content),
    status: entry.status,
    authorName: entry.author?.name ?? null,
    linkedPosts: entry.linkedPosts.map((p) => ({
      id: p.id,
      title: p.title,
      voteCount: p.voteCount,
      status: p.status,
    })),
    publishedAt: entry.publishedAt,
    displayDate: entry.displayDate,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })
}

async function getArticleDetails(articleId: KbArticleId): Promise<CallToolResult> {
  const article = await getArticleById(articleId)
  return articleResult(article)
}

async function getCategoryDetails(categoryId: KbCategoryId): Promise<CallToolResult> {
  const category = await getCategoryById(categoryId)
  return categoryResult(category)
}
