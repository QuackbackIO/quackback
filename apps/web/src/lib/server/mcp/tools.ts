/**
 * MCP Tools for Quackback
 *
 * 7 tools calling domain services directly (no HTTP self-loop):
 * - search: Unified search across posts and changelogs
 * - get_details: Get full details for any entity by TypeID
 * - triage_post: Update post status, tags, owner, official response
 * - vote_post: Toggle vote on a post
 * - add_comment: Post a comment on a post
 * - create_post: Submit new feedback
 * - create_changelog: Create a changelog entry
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import {
  listInboxPosts,
  getPostWithDetails,
  getCommentsWithReplies,
} from '@/lib/server/domains/posts/post.query'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import { voteOnPost } from '@/lib/server/domains/posts/post.voting'
import { createComment } from '@/lib/server/domains/comments/comment.service'
import {
  createChangelog,
  listChangelogs,
  getChangelogById,
} from '@/lib/server/domains/changelog/changelog.service'
import { getTypeIdPrefix } from '@quackback/ids'
import type { McpAuthContext, McpScope } from './types'
import type {
  PostId,
  BoardId,
  TagId,
  StatusId,
  PrincipalId,
  CommentId,
  ChangelogId,
} from '@quackback/ids'

// ============================================================================
// Helpers
// ============================================================================

/** Wrap a data object as a successful MCP tool result. */
function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

/** Convert a domain error to an MCP tool error result. */
function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : 'Unknown error'
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }],
  }
}

/** Encode a search cursor with entity type to prevent cross-entity misuse. */
function encodeSearchCursor(entity: string, value: number | string): string {
  return Buffer.from(JSON.stringify({ entity, value })).toString('base64url')
}

/** Decode a search cursor. Returns entity and value, or defaults. */
function decodeSearchCursor(cursor?: string): { entity: string; value: number | string } {
  if (!cursor) return { entity: '', value: 0 }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'))
    return { entity: decoded.entity ?? '', value: decoded.value ?? 0 }
  } catch {
    return { entity: '', value: 0 }
  }
}

/** Return an error if the token is missing a required scope. */
function requireScope(auth: McpAuthContext, scope: McpScope): CallToolResult | null {
  if (auth.scopes.includes(scope)) return null
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: Insufficient scope. Required: ${scope}` }],
  }
}

/** Return an error if the user doesn't have an admin or member role. */
function requireTeamRole(auth: McpAuthContext): CallToolResult | null {
  if (auth.role === 'admin' || auth.role === 'member') return null
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Error: This operation requires a team member (admin or member) role.',
      },
    ],
  }
}

// ============================================================================
// Annotations
// ============================================================================

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

// ============================================================================
// Schemas
// ============================================================================

const searchSchema = {
  entity: z
    .enum(['posts', 'changelogs'])
    .default('posts')
    .describe('Entity type to search. Defaults to posts.'),
  query: z.string().optional().describe('Text search across titles and content'),
  boardId: z.string().optional().describe('Filter posts by board TypeID (ignored for changelogs)'),
  status: z
    .string()
    .optional()
    .describe(
      'Filter by status. For posts: slug like "open", "in_progress". For changelogs: "draft", "published", "scheduled", "all".'
    ),
  tagIds: z
    .array(z.string())
    .optional()
    .describe('Filter posts by tag TypeIDs (ignored for changelogs)'),
  sort: z
    .enum(['newest', 'oldest', 'votes'])
    .default('newest')
    .describe('Sort order. "votes" only applies to posts.'),
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

const triagePostSchema = {
  postId: z.string().describe('Post TypeID to update'),
  statusId: z.string().optional().describe('New status TypeID'),
  tagIds: z.array(z.string()).optional().describe('Replace all tags with these TypeIDs'),
  ownerPrincipalId: z
    .string()
    .nullable()
    .optional()
    .describe('Assign to member TypeID, or null to unassign'),
  officialResponse: z
    .string()
    .max(5000)
    .nullable()
    .optional()
    .describe('Set official response text (max 5,000 chars), or null to clear'),
}

const addCommentSchema = {
  postId: z.string().describe('Post TypeID to comment on'),
  content: z.string().max(5000).describe('Comment text (max 5,000 characters)'),
  parentId: z.string().optional().describe('Parent comment TypeID for threaded reply'),
}

const createPostSchema = {
  boardId: z.string().describe('Board TypeID (use quackback://boards resource to find IDs)'),
  title: z.string().max(200).describe('Post title (max 200 characters)'),
  content: z.string().max(10000).optional().describe('Post content (max 10,000 characters)'),
  statusId: z.string().optional().describe('Initial status TypeID (defaults to board default)'),
  tagIds: z.array(z.string()).optional().describe('Tag TypeIDs to apply'),
}

const votePostSchema = {
  postId: z.string().describe('Post TypeID to vote on'),
}

const createChangelogSchema = {
  title: z.string().max(200).describe('Changelog entry title'),
  content: z
    .string()
    .max(50000)
    .describe('Changelog content (markdown supported, max 50,000 chars)'),
  publish: z
    .boolean()
    .default(false)
    .describe('Set to true to publish immediately. Defaults to draft.'),
}

// ============================================================================
// Type aliases — manually defined to avoid deep Zod type recursion
// ============================================================================

type SearchArgs = {
  entity: 'posts' | 'changelogs'
  query?: string
  boardId?: string
  status?: string
  tagIds?: string[]
  sort: 'newest' | 'oldest' | 'votes'
  limit: number
  cursor?: string
}

type GetDetailsArgs = { id: string }

type TriagePostArgs = {
  postId: string
  statusId?: string
  tagIds?: string[]
  ownerPrincipalId?: string | null
  officialResponse?: string | null
}

type AddCommentArgs = {
  postId: string
  content: string
  parentId?: string
}

type CreatePostArgs = {
  boardId: string
  title: string
  content?: string
  statusId?: string
  tagIds?: string[]
}

type VotePostArgs = { postId: string }

type CreateChangelogArgs = {
  title: string
  content: string
  publish: boolean
}

// ============================================================================
// Tool registration
// ============================================================================

export function registerTools(server: McpServer, auth: McpAuthContext) {
  // search
  server.tool(
    'search',
    `Search feedback posts or changelog entries. Returns paginated results with a cursor for fetching more.

Examples:
- Search all posts: search()
- Search by text: search({ query: "dark mode" })
- Filter by board and status: search({ boardId: "board_01abc...", status: "open" })
- Search changelogs: search({ entity: "changelogs", status: "published" })
- Sort by votes: search({ sort: "votes", limit: 10 })`,
    searchSchema,
    READ_ONLY,
    async (args: SearchArgs): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:feedback')
      if (denied) return denied
      try {
        if (args.entity === 'changelogs') {
          return await searchChangelogs(args)
        }
        return await searchPosts(args)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_details
  server.tool(
    'get_details',
    `Get full details for any entity by TypeID. Entity type is auto-detected from the ID prefix.

Examples:
- Get a post: get_details({ id: "post_01abc..." })
- Get a changelog: get_details({ id: "changelog_01xyz..." })`,
    getDetailsSchema,
    READ_ONLY,
    async (args: GetDetailsArgs): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:feedback')
      if (denied) return denied
      try {
        let prefix: string
        try {
          prefix = getTypeIdPrefix(args.id)
        } catch {
          return errorResult(
            new Error(
              `Invalid TypeID format: "${args.id}". Expected format: prefix_base32suffix (e.g., post_01abc..., changelog_01xyz...)`
            )
          )
        }

        switch (prefix) {
          case 'post':
            return await getPostDetails(args.id as PostId)
          case 'changelog':
            return await getChangelogDetails(args.id as ChangelogId)
          default:
            return errorResult(
              new Error(`Unsupported entity type: "${prefix}". Supported: post, changelog`)
            )
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // triage_post
  server.tool(
    'triage_post',
    `Update a post: set status, tags, owner, and/or official response. All fields optional — only provided fields are updated.

Examples:
- Change status: triage_post({ postId: "post_01abc...", statusId: "status_01xyz..." })
- Assign owner and set response: triage_post({ postId: "post_01abc...", ownerPrincipalId: "principal_01xyz...", officialResponse: "We're working on this!" })
- Replace tags: triage_post({ postId: "post_01abc...", tagIds: ["tag_01a...", "tag_01b..."] })`,
    triagePostSchema,
    WRITE,
    async (args: TriagePostArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const result = await updatePost(
          args.postId as PostId,
          {
            statusId: args.statusId as StatusId | undefined,
            tagIds: args.tagIds as TagId[] | undefined,
            ownerPrincipalId: args.ownerPrincipalId as PrincipalId | null | undefined,
            officialResponse: args.officialResponse,
          },
          { principalId: auth.principalId, name: auth.name }
        )

        return jsonResult({
          id: result.id,
          title: result.title,
          statusId: result.statusId,
          ownerPrincipalId: result.ownerPrincipalId,
          officialResponse: result.officialResponse,
          officialResponseAt: result.officialResponseAt,
          updatedAt: result.updatedAt,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // vote_post
  server.tool(
    'vote_post',
    `Toggle vote on a feedback post. If not yet voted, adds a vote. If already voted, removes the vote.

Examples:
- Vote on a post: vote_post({ postId: "post_01abc..." })
- Unvote (call again): vote_post({ postId: "post_01abc..." })`,
    votePostSchema,
    WRITE,
    async (args: VotePostArgs): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback')
      if (denied) return denied
      try {
        const result = await voteOnPost(args.postId as PostId, auth.principalId)

        return jsonResult({
          postId: args.postId,
          voted: result.voted,
          voteCount: result.voteCount,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // add_comment
  server.tool(
    'add_comment',
    `Post a comment on a feedback post. Supports threaded replies via parentId.

Examples:
- Top-level comment: add_comment({ postId: "post_01abc...", content: "Thanks for the feedback!" })
- Threaded reply: add_comment({ postId: "post_01abc...", content: "Good point.", parentId: "comment_01xyz..." })`,
    addCommentSchema,
    WRITE,
    async (args: AddCommentArgs): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback')
      if (denied) return denied
      try {
        const result = await createComment(
          {
            postId: args.postId as PostId,
            content: args.content,
            parentId: args.parentId as CommentId | undefined,
          },
          {
            principalId: auth.principalId,
            userId: auth.userId,
            name: auth.name,
            email: auth.email,
            displayName: auth.name,
            role: auth.role,
          }
        )

        return jsonResult({
          id: result.comment.id,
          postId: result.comment.postId,
          content: result.comment.content,
          parentId: result.comment.parentId,
          isTeamMember: result.comment.isTeamMember,
          createdAt: result.comment.createdAt,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // create_post
  server.tool(
    'create_post',
    `Submit new feedback on a board. Requires board and title; content/status/tags optional.

Examples:
- Minimal: create_post({ boardId: "board_01abc...", title: "Add dark mode" })
- Full: create_post({ boardId: "board_01abc...", title: "Add dark mode", content: "Would love a dark theme option.", statusId: "status_01xyz...", tagIds: ["tag_01a..."] })`,
    createPostSchema,
    WRITE,
    async (args: CreatePostArgs): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback')
      if (denied) return denied
      try {
        const result = await createPost(
          {
            boardId: args.boardId as BoardId,
            title: args.title,
            content: args.content ?? '',
            statusId: args.statusId as StatusId | undefined,
            tagIds: args.tagIds as TagId[] | undefined,
          },
          {
            principalId: auth.principalId,
            userId: auth.userId,
            name: auth.name,
            email: auth.email,
            displayName: auth.name,
          }
        )

        return jsonResult({
          id: result.id,
          title: result.title,
          boardId: result.boardId,
          statusId: result.statusId,
          createdAt: result.createdAt,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // create_changelog
  server.tool(
    'create_changelog',
    `Create a changelog entry. Saves as draft by default; set publish: true to publish immediately.

Examples:
- Draft: create_changelog({ title: "v2.1 Release", content: "## New features\\n- Dark mode..." })
- Published: create_changelog({ title: "v2.1 Release", content: "## New features\\n- Dark mode...", publish: true })`,
    createChangelogSchema,
    WRITE,
    async (args: CreateChangelogArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:changelog')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const result = await createChangelog(
          {
            title: args.title,
            content: args.content,
            publishState: { type: args.publish ? 'published' : 'draft' },
          },
          { principalId: auth.principalId, name: auth.name }
        )

        return jsonResult({
          id: result.id,
          title: result.title,
          status: result.status,
          publishedAt: result.publishedAt,
          createdAt: result.createdAt,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
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
  const offset = typeof decoded.value === 'number' ? decoded.value : 0
  const limit = args.limit || 20
  const page = Math.floor(offset / limit) + 1

  const result = await listInboxPosts({
    search: args.query,
    boardIds: args.boardId ? [args.boardId as BoardId] : undefined,
    statusSlugs: args.status ? [args.status] : undefined,
    tagIds: args.tagIds as TagId[] | undefined,
    sort: args.sort || 'newest',
    page,
    limit,
  })

  const nextOffset = offset + result.items.length
  const nextCursor = result.hasMore ? encodeSearchCursor('posts', nextOffset) : null

  return jsonResult({
    posts: result.items.map((p) => ({
      id: p.id,
      title: p.title,
      content: p.content,
      voteCount: p.voteCount,
      commentCount: p.commentCount,
      boardId: p.boardId,
      boardName: p.board?.name,
      statusId: p.statusId,
      authorName: p.authorName,
      ownerPrincipalId: p.ownerPrincipalId,
      tags: p.tags?.map((t) => ({ id: t.id, name: t.name })),
      createdAt: p.createdAt,
    })),
    nextCursor,
    hasMore: result.hasMore,
    total: result.total,
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
    limit: args.limit || 20,
  })

  // Encode next cursor using the last item's ID
  const lastItem = result.items[result.items.length - 1]
  const nextCursor =
    result.hasMore && lastItem ? encodeSearchCursor('changelogs', lastItem.id) : null

  return jsonResult({
    changelogs: result.items.map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      status: c.status,
      authorName: c.author?.name ?? null,
      linkedPosts: c.linkedPosts.map((p) => ({
        id: p.id,
        title: p.title,
        voteCount: p.voteCount,
      })),
      publishedAt: c.publishedAt,
      createdAt: c.createdAt,
    })),
    nextCursor,
    hasMore: result.hasMore,
  })
}

// ============================================================================
// Get details dispatchers
// ============================================================================

async function getPostDetails(postId: PostId): Promise<CallToolResult> {
  const [post, comments] = await Promise.all([
    getPostWithDetails(postId),
    getCommentsWithReplies(postId),
  ])

  return jsonResult({
    id: post.id,
    title: post.title,
    content: post.content,
    voteCount: post.voteCount,
    commentCount: post.commentCount,
    boardId: post.boardId,
    boardName: post.board?.name,
    boardSlug: post.board?.slug,
    statusId: post.statusId,
    authorName: post.authorName,
    ownerPrincipalId: post.ownerPrincipalId,
    officialResponse: post.officialResponse,
    officialResponseAuthorName: post.officialResponseAuthorName,
    officialResponseAt: post.officialResponseAt,
    tags: post.tags?.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    roadmapIds: post.roadmapIds,
    pinnedComment: post.pinnedComment
      ? {
          id: post.pinnedComment.id,
          content: post.pinnedComment.content,
          authorName: post.pinnedComment.authorName,
          createdAt: post.pinnedComment.createdAt,
        }
      : null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    comments,
  })
}

async function getChangelogDetails(changelogId: ChangelogId): Promise<CallToolResult> {
  const entry = await getChangelogById(changelogId)

  return jsonResult({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    status: entry.status,
    authorName: entry.author?.name ?? null,
    linkedPosts: entry.linkedPosts.map((p) => ({
      id: p.id,
      title: p.title,
      voteCount: p.voteCount,
      status: p.status,
    })),
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })
}
