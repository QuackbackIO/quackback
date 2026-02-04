/**
 * MCP Tools for Quackback
 *
 * 6 tools for interacting with the Quackback feedback platform:
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
import { api, type ApiConfig } from './api.js'
import { AuthError } from './errors.js'
import type {
  ApiPost,
  ApiPostDetail,
  ApiComment,
  ApiChangelogEntry,
  ApiResponse,
  PaginationMeta,
} from './types.js'

/** Convert an error to a tool error result. Auth errors re-throw as protocol errors. */
function errorResult(err: unknown): CallToolResult {
  if (err instanceof AuthError) throw err
  const message = err instanceof Error ? err.message : 'Unknown error'
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }],
  }
}

// Define schemas outside of registerTools to help TypeScript
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

// Type aliases for tool args - manually defined to avoid deep type recursion
type SearchFeedbackArgs = {
  query?: string
  boardId?: string
  status?: string
  tagIds?: string[]
  sort: 'newest' | 'oldest' | 'votes'
  limit: number
  cursor?: string
}

type GetPostArgs = {
  postId: string
}

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

export function registerTools(server: McpServer, config: ApiConfig) {
  // search_feedback
  server.tool(
    'search_feedback',
    'Search feedback posts with filtering by board, status, tags, text, and sort order. Returns paginated results with a cursor for fetching more.',
    searchFeedbackSchema,
    // @ts-expect-error - MCP SDK Zod type inference is too deep for complex schemas
    async (args: SearchFeedbackArgs): Promise<CallToolResult> => {
      try {
        const params = new URLSearchParams()
        if (args.query) params.set('search', args.query)
        if (args.boardId) params.set('boardId', args.boardId)
        if (args.status) params.set('status', args.status)
        if (args.tagIds?.length) params.set('tagIds', args.tagIds.join(','))
        params.set('sort', args.sort || 'newest')
        params.set('limit', String(args.limit || 20))
        if (args.cursor) params.set('cursor', args.cursor)

        const result = await api<
          ApiResponse<ApiPost[]> & { meta?: { pagination?: PaginationMeta } }
        >(config, `/posts?${params}`)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  posts: result.data,
                  nextCursor: result.meta?.pagination?.cursor ?? null,
                  hasMore: result.meta?.pagination?.hasMore ?? false,
                  total: result.meta?.pagination?.total,
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
        const [postRes, commentsRes] = await Promise.all([
          api<ApiResponse<ApiPostDetail>>(config, `/posts/${args.postId}`),
          api<ApiResponse<ApiComment[]>>(config, `/posts/${args.postId}/comments`),
        ])

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ...postRes.data, comments: commentsRes.data }, null, 2),
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
    // @ts-expect-error - MCP SDK Zod type inference is too deep for complex schemas
    async (args: TriagePostArgs): Promise<CallToolResult> => {
      try {
        const { postId, ...updates } = args
        const result = await api<ApiResponse<ApiPost>>(config, `/posts/${postId}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        })

        return {
          content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
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
        const result = await api<ApiResponse<ApiComment>>(
          config,
          `/posts/${args.postId}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({ content: args.content, parentId: args.parentId }),
          }
        )

        return {
          content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
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
        const result = await api<ApiResponse<ApiPost>>(config, '/posts', {
          method: 'POST',
          body: JSON.stringify(args),
        })

        return {
          content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
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
        const result = await api<ApiResponse<ApiChangelogEntry>>(config, '/changelog', {
          method: 'POST',
          body: JSON.stringify(args),
        })

        return {
          content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}
