/**
 * MCP Tools for Quackback
 *
 * 6 tools calling domain services directly (no HTTP self-loop):
 * - search_feedback: Search and filter posts
 * - get_post: Get a single post with comments
 * - triage_post: Update post status, tags, owner, official response
 * - add_comment: Post a comment on a post
 * - create_post: Submit new feedback
 * - create_changelog: Create a changelog entry
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { listInboxPosts } from '@/lib/server/domains/posts/post.query'
import { getPostWithDetails, getCommentsWithReplies } from '@/lib/server/domains/posts/post.query'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import { createComment } from '@/lib/server/domains/comments/comment.service'
import { createChangelog } from '@/lib/server/domains/changelog/changelog.service'
import { encodeCursor, decodeCursor } from '@/lib/server/domains/api/responses'
import type { McpAuthContext } from './types'
import type { PostId, BoardId, TagId, StatusId, MemberId, CommentId } from '@quackback/ids'

/** Convert a domain error to an MCP tool error result. */
function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : 'Unknown error'
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }],
  }
}

// Zod schemas — identical names/descriptions to the old stdio tools
const searchFeedbackSchema = {
  query: z.string().optional().describe('Text search across post titles and content'),
  boardId: z.string().optional().describe('Filter by board TypeID (e.g., board_xxx)'),
  status: z.string().optional().describe('Filter by status slug (e.g., "open", "in_progress")'),
  tagIds: z.array(z.string()).optional().describe('Filter by tag TypeIDs'),
  sort: z.enum(['newest', 'oldest', 'votes']).default('newest').describe('Sort order'),
  limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
}

const getPostSchema = {
  postId: z.string().describe('Post TypeID (e.g., post_xxx)'),
}

const triagePostSchema = {
  postId: z.string().describe('Post TypeID to update'),
  statusId: z.string().optional().describe('New status TypeID'),
  tagIds: z.array(z.string()).optional().describe('Replace all tags with these TypeIDs'),
  ownerMemberId: z
    .string()
    .nullable()
    .optional()
    .describe('Assign to member TypeID, or null to unassign'),
  officialResponse: z
    .string()
    .nullable()
    .optional()
    .describe('Set official response text, or null to clear'),
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

const createChangelogSchema = {
  title: z.string().max(200).describe('Changelog entry title'),
  content: z.string().describe('Changelog content (markdown supported)'),
  publishedAt: z.string().optional().describe('ISO 8601 publish date (omit to save as draft)'),
}

// Type aliases — manually defined to avoid deep Zod type recursion
type SearchFeedbackArgs = {
  query?: string
  boardId?: string
  status?: string
  tagIds?: string[]
  sort: 'newest' | 'oldest' | 'votes'
  limit: number
  cursor?: string
}

type GetPostArgs = { postId: string }

type TriagePostArgs = {
  postId: string
  statusId?: string
  tagIds?: string[]
  ownerMemberId?: string | null
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

type CreateChangelogArgs = {
  title: string
  content: string
  publishedAt?: string
}

export function registerTools(server: McpServer, auth: McpAuthContext) {
  // search_feedback
  server.tool(
    'search_feedback',
    'Search feedback posts with filtering by board, status, tags, text, and sort order. Returns paginated results with a cursor for fetching more.',
    searchFeedbackSchema,
    async (args: SearchFeedbackArgs): Promise<CallToolResult> => {
      try {
        // Cursor-to-offset translation: MCP exposes cursor, service uses page/limit
        const offset = decodeCursor(args.cursor)
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

        // Encode next cursor from current offset
        const nextOffset = offset + result.items.length
        const nextCursor = result.hasMore ? encodeCursor(nextOffset) : null

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
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
                    ownerMemberId: p.ownerMemberId,
                    tags: p.tags?.map((t) => ({ id: t.id, name: t.name })),
                    createdAt: p.createdAt,
                  })),
                  nextCursor,
                  hasMore: result.hasMore,
                  total: result.total,
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_post
  server.tool(
    'get_post',
    'Get a single post with full details including comments, votes, tags, status, and official response.',
    getPostSchema,
    async (args: GetPostArgs): Promise<CallToolResult> => {
      try {
        const [post, comments] = await Promise.all([
          getPostWithDetails(args.postId as PostId),
          getCommentsWithReplies(args.postId as PostId),
        ])

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
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
                  authorEmail: post.authorEmail,
                  ownerMemberId: post.ownerMemberId,
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
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // triage_post
  server.tool(
    'triage_post',
    'Update a post: set status, tags, owner, and/or official response. All fields optional — only provided fields are updated.',
    triagePostSchema,
    async (args: TriagePostArgs): Promise<CallToolResult> => {
      try {
        const result = await updatePost(
          args.postId as PostId,
          {
            statusId: args.statusId as StatusId | undefined,
            tagIds: args.tagIds as TagId[] | undefined,
            ownerMemberId: args.ownerMemberId as MemberId | null | undefined,
            officialResponse: args.officialResponse,
          },
          { memberId: auth.memberId, name: auth.name }
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: result.id,
                  title: result.title,
                  statusId: result.statusId,
                  ownerMemberId: result.ownerMemberId,
                  officialResponse: result.officialResponse,
                  officialResponseAt: result.officialResponseAt,
                  updatedAt: result.updatedAt,
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // add_comment
  server.tool(
    'add_comment',
    'Post a comment on a feedback post. Supports threaded replies via parentId.',
    addCommentSchema,
    async (args: AddCommentArgs): Promise<CallToolResult> => {
      try {
        const result = await createComment(
          {
            postId: args.postId as PostId,
            content: args.content,
            parentId: args.parentId as CommentId | undefined,
          },
          {
            memberId: auth.memberId,
            userId: auth.userId,
            name: auth.name,
            email: auth.email,
            role: auth.role,
          }
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.comment, null, 2),
            },
          ],
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // create_post
  server.tool(
    'create_post',
    'Submit new feedback on a board. Requires board and title; content/status/tags optional.',
    createPostSchema,
    async (args: CreatePostArgs): Promise<CallToolResult> => {
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
            memberId: auth.memberId,
            userId: auth.userId,
            name: auth.name,
            email: auth.email,
          }
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: result.id,
                  title: result.title,
                  boardId: result.boardId,
                  statusId: result.statusId,
                  createdAt: result.createdAt,
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // create_changelog
  server.tool(
    'create_changelog',
    'Create a changelog entry. Omit publishedAt to save as draft.',
    createChangelogSchema,
    async (args: CreateChangelogArgs): Promise<CallToolResult> => {
      try {
        // Translate publishedAt string to publishState discriminated union
        const publishState = args.publishedAt
          ? { type: 'published' as const }
          : { type: 'draft' as const }

        const result = await createChangelog(
          {
            title: args.title,
            content: args.content,
            publishState,
          },
          { memberId: auth.memberId, name: auth.name }
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: result.id,
                  title: result.title,
                  status: result.status,
                  publishedAt: result.publishedAt,
                  createdAt: result.createdAt,
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}
