/**
 * MCP Tools for Featurepool
 *
 * 23 tools calling domain services directly (no HTTP self-loop):
 * - search: Unified search across posts and changelogs
 * - get_details: Get full details for any entity by TypeID
 * - triage_post: Update post status, tags, and owner
 * - vote_post: Toggle vote on a post
 * - proxy_vote: Add or remove a vote on behalf of another user
 * - add_comment: Post a comment on a post
 * - create_post: Submit new feedback
 * - delete_post: Soft-delete a post
 * - restore_post: Restore a soft-deleted post
 * - create_changelog: Create a changelog entry
 * - update_changelog: Update title, content, publish state, linked posts
 * - delete_changelog: Soft-delete a changelog entry
 * - update_comment: Edit a comment's content
 * - delete_comment: Hard-delete a comment and its replies
 * - react_to_comment: Add or remove emoji reaction on a comment
 * - manage_roadmap_post: Add or remove a post from a roadmap
 * - merge_post: Merge a duplicate post into a canonical post
 * - unmerge_post: Restore a merged post to independent state
 * - list_suggestions: List AI-generated feedback suggestions
 * - accept_suggestion: Accept a feedback or merge suggestion
 * - dismiss_suggestion: Dismiss a suggestion
 * - restore_suggestion: Restore a dismissed suggestion to pending
 * - get_post_activity: Get activity log for a post
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { getPostWithDetails, getCommentsWithReplies } from '@/lib/server/domains/posts/post.query'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import { voteOnPost, addVoteOnBehalf, removeVote } from '@/lib/server/domains/posts/post.voting'
import { mergePost, unmergePost, getMergedPosts } from '@/lib/server/domains/posts/post.merge'
import { softDeletePost, restorePost } from '@/lib/server/domains/posts/post.user-actions'
import { getActivityForPost, createActivity } from '@/lib/server/domains/activity/activity.service'
import {
  acceptCreateSuggestion,
  acceptVoteSuggestion,
  dismissSuggestion as dismissFeedbackSuggestion,
  restoreSuggestion as restoreFeedbackSuggestion,
} from '@/lib/server/domains/feedback/pipeline/suggestion.service'
import {
  acceptMergeSuggestion,
  dismissMergeSuggestion,
  restoreMergeSuggestion,
} from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
import {
  createComment,
  updateComment,
  deleteComment,
} from '@/lib/server/domains/comments/comment.service'
import { addReaction, removeReaction } from '@/lib/server/domains/comments/comment.reactions'
import {
  createChangelog,
  updateChangelog,
  deleteChangelog,
  getChangelogById,
} from '@/lib/server/domains/changelog/changelog.service'
import { listChangelogs } from '@/lib/server/domains/changelog/changelog.query'
import { publishedAtToPublishState, type PublishState } from '@/lib/shared/schemas/changelog'
import {
  addPostToRoadmap,
  removePostFromRoadmap,
} from '@/lib/server/domains/roadmaps/roadmap.service'
import { getTypeIdPrefix, isTypeId, isValidTypeId } from '@featurepool/ids'
import { isTeamMember } from '@/lib/shared/roles'
import type { McpAuthContext, McpScope } from './types'
import type {
  PostId,
  BoardId,
  TagId,
  StatusId,
  PrincipalId,
  CommentId,
  ChangelogId,
  RoadmapId,
  FeedbackSuggestionId,
  MergeSuggestionId,
} from '@featurepool/ids'

// ============================================================================
// Helpers
// ============================================================================

/** Wrap a data object as a successful MCP tool result (pretty-printed, for single-entity responses). */
function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

/** Wrap a data object as a compact MCP tool result (no pretty-print, for list responses). */
function compactJsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
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
  if (isTeamMember(auth.role)) return null
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
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
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

const triagePostSchema = {
  postId: z.string().describe('Post TypeID to update'),
  statusId: z.string().optional().describe('New status TypeID'),
  tagIds: z.array(z.string()).optional().describe('Replace all tags with these TypeIDs'),
  ownerPrincipalId: z
    .string()
    .nullable()
    .optional()
    .describe('Assign to member TypeID, or null to unassign'),
}

const addCommentSchema = {
  postId: z.string().describe('Post TypeID to comment on'),
  content: z.string().max(5000).describe('Comment text (max 5,000 characters)'),
  parentId: z.string().optional().describe('Parent comment TypeID for threaded reply'),
  isPrivate: z
    .boolean()
    .optional()
    .describe('If true, comment is an internal note visible only to team members'),
}

const createPostSchema = {
  boardId: z.string().describe('Board TypeID (use featurepool://boards resource to find IDs)'),
  title: z.string().max(200).describe('Post title (max 200 characters)'),
  content: z.string().max(10000).optional().describe('Post content (max 10,000 characters)'),
  statusId: z.string().optional().describe('Initial status TypeID (defaults to board default)'),
  tagIds: z.array(z.string()).optional().describe('Tag TypeIDs to apply'),
}

const votePostSchema = {
  postId: z.string().describe('Post TypeID to vote on'),
}

const proxyVoteSchema = {
  action: z
    .enum(['add', 'remove'])
    .default('add')
    .describe('Whether to add or remove the proxy vote'),
  postId: z.string().describe('Post TypeID to vote on'),
  voterPrincipalId: z.string().describe('Principal TypeID of the user to vote on behalf of'),
  sourceType: z.string().optional().describe('Attribution source type (e.g. "zendesk", "slack")'),
  sourceExternalUrl: z.string().optional().describe('URL linking to the originating record'),
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
  publishedAt: z
    .string()
    .optional()
    .describe(
      'ISO 8601 datetime to publish at (e.g. "2025-03-15T12:00:00Z"). Overrides publish flag. Past dates backdate the entry, future dates schedule it.'
    ),
}

const updateChangelogSchema = {
  changelogId: z.string().describe('Changelog TypeID to update'),
  title: z.string().max(200).optional().describe('New title'),
  content: z
    .string()
    .max(50000)
    .optional()
    .describe('New content (markdown supported, max 50,000 chars)'),
  publish: z.boolean().optional().describe('Set to true to publish, false to revert to draft'),
  publishedAt: z
    .string()
    .optional()
    .describe(
      'ISO 8601 datetime to set as publish date (e.g. "2025-03-15T12:00:00Z"). Overrides publish flag. Past dates backdate, future dates schedule, null reverts to draft.'
    ),
  linkedPostIds: z
    .array(z.string())
    .optional()
    .describe('Replace linked posts with these post TypeIDs'),
}

const deleteChangelogSchema = {
  changelogId: z.string().describe('Changelog TypeID to delete'),
}

const updateCommentSchema = {
  commentId: z.string().describe('Comment TypeID to edit'),
  content: z.string().max(5000).describe('New comment text (max 5,000 characters)'),
}

const deleteCommentSchema = {
  commentId: z.string().describe('Comment TypeID to delete'),
}

const reactToCommentSchema = {
  action: z.enum(['add', 'remove']).describe('Whether to add or remove the reaction'),
  commentId: z.string().describe('Comment TypeID to react to'),
  emoji: z.string().max(32).describe('Emoji to react with (e.g., "👍", "❤️", "🎉")'),
}

const manageRoadmapPostSchema = {
  action: z.enum(['add', 'remove']).describe('Whether to add or remove the post from the roadmap'),
  roadmapId: z.string().describe('Roadmap TypeID'),
  postId: z.string().describe('Post TypeID'),
}

const mergePostSchema = {
  duplicatePostId: z.string().describe('Post TypeID of the duplicate to merge away'),
  canonicalPostId: z.string().describe('Post TypeID of the canonical post to merge into'),
}

const unmergePostSchema = {
  postId: z.string().describe('Post TypeID of the merged post to restore'),
}

const deletePostSchema = {
  postId: z.string().describe('Post TypeID to delete'),
}

const restorePostSchema = {
  postId: z.string().describe('Post TypeID to restore'),
}

const listSuggestionsSchema = {
  status: z
    .enum(['pending', 'dismissed'])
    .default('pending')
    .describe('Filter by status: pending or dismissed'),
  suggestionType: z
    .enum(['create_post', 'vote_on_post', 'duplicate_post'])
    .optional()
    .describe('Filter by suggestion type'),
  sort: z.enum(['newest', 'relevance']).default('newest').describe('Sort order'),
  limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
}

const acceptSuggestionSchema = {
  id: z.string().describe('Suggestion TypeID (feedback_suggestion_xxx or merge_sug_xxx)'),
  edits: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      boardId: z.string().optional(),
      statusId: z.string().optional(),
    })
    .optional()
    .describe('Optional edits to apply before accepting (create_post type only)'),
  swapDirection: z.boolean().optional().describe('Swap merge direction (duplicate_post type only)'),
}

const dismissSuggestionSchema = {
  id: z
    .string()
    .describe('Suggestion TypeID to dismiss (feedback_suggestion_xxx or merge_sug_xxx)'),
}

const restoreSuggestionSchema = {
  id: z
    .string()
    .describe(
      'Suggestion TypeID to restore from dismissed to pending (feedback_suggestion_xxx or merge_sug_xxx)'
    ),
}

const getPostActivitySchema = {
  postId: z.string().describe('Post TypeID to get activity for'),
}

// ============================================================================
// Type aliases — manually defined to avoid deep Zod type recursion.
// WARNING: These must stay in sync with the Zod schemas above.
// If you add/remove/rename a field in a schema, update the matching type here.
// ============================================================================

type SearchArgs = {
  entity: 'posts' | 'changelogs'
  query?: string
  boardId?: string
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

type TriagePostArgs = {
  postId: string
  statusId?: string
  tagIds?: string[]
  ownerPrincipalId?: string | null
}

type AddCommentArgs = {
  postId: string
  content: string
  parentId?: string
  isPrivate?: boolean
}

type CreatePostArgs = {
  boardId: string
  title: string
  content?: string
  statusId?: string
  tagIds?: string[]
}

type VotePostArgs = { postId: string }

type ProxyVoteArgs = {
  action: 'add' | 'remove'
  postId: string
  voterPrincipalId: string
  sourceType?: string
  sourceExternalUrl?: string
}

type CreateChangelogArgs = {
  title: string
  content: string
  publish: boolean
  publishedAt?: string
}

type UpdateChangelogArgs = {
  changelogId: string
  title?: string
  content?: string
  publish?: boolean
  publishedAt?: string
  linkedPostIds?: string[]
}

type DeleteChangelogArgs = { changelogId: string }

type UpdateCommentArgs = {
  commentId: string
  content: string
}

type DeleteCommentArgs = { commentId: string }

type ReactToCommentArgs = {
  action: 'add' | 'remove'
  commentId: string
  emoji: string
}

type ManageRoadmapPostArgs = {
  action: 'add' | 'remove'
  roadmapId: string
  postId: string
}

type MergePostArgs = {
  duplicatePostId: string
  canonicalPostId: string
}

type UnmergePostArgs = { postId: string }

type DeletePostArgs = { postId: string }

type RestorePostArgs = { postId: string }

type ListSuggestionsArgs = {
  status: 'pending' | 'dismissed'
  suggestionType?: 'create_post' | 'vote_on_post' | 'duplicate_post'
  sort: 'newest' | 'relevance'
  limit: number
  cursor?: string
}

type AcceptSuggestionArgs = {
  id: string
  edits?: {
    title?: string
    body?: string
    boardId?: string
    statusId?: string
  }
  swapDirection?: boolean
}

type DismissSuggestionArgs = { id: string }

type RestoreSuggestionArgs = { id: string }

type GetPostActivityArgs = { postId: string }

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
      // showDeleted requires team role
      if (args.showDeleted) {
        const roleDenied = requireTeamRole(auth)
        if (roleDenied) return roleDenied
      }
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
    `Update a post: set status, tags, and/or owner. All fields optional — only provided fields are updated.

Examples:
- Change status: triage_post({ postId: "post_01abc...", statusId: "status_01xyz..." })
- Assign owner: triage_post({ postId: "post_01abc...", ownerPrincipalId: "principal_01xyz..." })
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
          },
          {
            principalId: auth.principalId,
            userId: auth.userId,
            email: auth.email,
            displayName: auth.name,
          }
        )

        return jsonResult({
          id: result.id,
          title: result.title,
          statusId: result.statusId,
          ownerPrincipalId: result.ownerPrincipalId,
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

  // proxy_vote
  server.tool(
    'proxy_vote',
    `Add or remove a vote on behalf of another user. Requires team role.

Examples:
- Add proxy vote: proxy_vote({ postId: "post_01abc...", voterPrincipalId: "principal_01xyz..." })
- Add with attribution: proxy_vote({ postId: "post_01abc...", voterPrincipalId: "principal_01xyz...", sourceType: "zendesk", sourceExternalUrl: "https://..." })
- Remove vote: proxy_vote({ action: "remove", postId: "post_01abc...", voterPrincipalId: "principal_01xyz..." })`,
    proxyVoteSchema,
    WRITE,
    async (args: ProxyVoteArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        if (args.action === 'remove') {
          const result = await removeVote(
            args.postId as PostId,
            args.voterPrincipalId as PrincipalId
          )
          if (result.removed) {
            createActivity({
              postId: args.postId as PostId,
              principalId: auth.principalId,
              type: 'vote.removed',
              metadata: { voterPrincipalId: args.voterPrincipalId },
            })
          }
          return jsonResult({
            postId: args.postId,
            voterPrincipalId: args.voterPrincipalId,
            removed: result.removed,
            voteCount: result.voteCount,
          })
        }

        const source = args.sourceType
          ? { type: args.sourceType, externalUrl: args.sourceExternalUrl ?? '' }
          : { type: 'proxy', externalUrl: '' }

        const result = await addVoteOnBehalf(
          args.postId as PostId,
          args.voterPrincipalId as PrincipalId,
          source,
          null,
          auth.principalId
        )
        if (result.voted) {
          createActivity({
            postId: args.postId as PostId,
            principalId: auth.principalId,
            type: 'vote.proxy',
            metadata: { voterPrincipalId: args.voterPrincipalId },
          })
        }
        return jsonResult({
          postId: args.postId,
          voterPrincipalId: args.voterPrincipalId,
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
    `Post a comment on a feedback post. Supports threaded replies via parentId. Set isPrivate to create an internal note visible only to team members.

Examples:
- Top-level comment: add_comment({ postId: "post_01abc...", content: "Thanks for the feedback!" })
- Threaded reply: add_comment({ postId: "post_01abc...", content: "Good point.", parentId: "comment_01xyz..." })
- Internal note: add_comment({ postId: "post_01abc...", content: "Discussed in standup, prioritizing for Q3.", isPrivate: true })`,
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
            isPrivate: args.isPrivate,
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
          isPrivate: result.comment.isPrivate,
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
- Published: create_changelog({ title: "v2.1 Release", content: "## New features\\n- Dark mode...", publish: true })
- Backdated: create_changelog({ title: "v2.1 Release", content: "...", publishedAt: "2025-03-15T12:00:00Z" })`,
    createChangelogSchema,
    WRITE,
    async (args: CreateChangelogArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:changelog')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const publishState = args.publishedAt
          ? publishedAtToPublishState(args.publishedAt)
          : ({ type: args.publish ? 'published' : 'draft' } as const)
        const result = await createChangelog(
          {
            title: args.title,
            content: args.content,
            publishState,
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

  // update_changelog
  server.tool(
    'update_changelog',
    `Update title, content, publish state, and/or linked posts on an existing changelog entry.

Examples:
- Update title: update_changelog({ changelogId: "changelog_01abc...", title: "v2.0 Release" })
- Publish: update_changelog({ changelogId: "changelog_01abc...", publish: true })
- Backdate: update_changelog({ changelogId: "changelog_01abc...", publishedAt: "2025-03-15T12:00:00Z" })
- Link posts: update_changelog({ changelogId: "changelog_01abc...", linkedPostIds: ["post_01a...", "post_01b..."] })`,
    updateChangelogSchema,
    WRITE,
    async (args: UpdateChangelogArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:changelog')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        let publishState: PublishState | undefined
        if (args.publishedAt !== undefined) {
          publishState = publishedAtToPublishState(args.publishedAt)
        } else if (args.publish === true) {
          publishState = { type: 'published' }
        } else if (args.publish === false) {
          publishState = { type: 'draft' }
        }

        const result = await updateChangelog(args.changelogId as ChangelogId, {
          title: args.title,
          content: args.content,
          linkedPostIds: args.linkedPostIds as PostId[] | undefined,
          publishState,
        })

        return jsonResult({
          id: result.id,
          title: result.title,
          status: result.status,
          publishedAt: result.publishedAt,
          updatedAt: result.updatedAt,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // delete_changelog
  server.tool(
    'delete_changelog',
    `Soft-delete a changelog entry. This cannot be undone via the API.

Examples:
- Delete: delete_changelog({ changelogId: "changelog_01abc..." })`,
    deleteChangelogSchema,
    DESTRUCTIVE,
    async (args: DeleteChangelogArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:changelog')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        await deleteChangelog(args.changelogId as ChangelogId)

        return jsonResult({ deleted: true, changelogId: args.changelogId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // update_comment
  server.tool(
    'update_comment',
    `Edit a comment's content. Team members can edit any comment; authors can edit their own.

Examples:
- Edit: update_comment({ commentId: "comment_01abc...", content: "Updated feedback response." })`,
    updateCommentSchema,
    WRITE,
    async (args: UpdateCommentArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      // No team role gate — the service layer allows comment authors OR team members
      try {
        const result = await updateComment(
          args.commentId as CommentId,
          { content: args.content },
          { principalId: auth.principalId, role: auth.role }
        )

        return jsonResult({
          id: result.id,
          postId: result.postId,
          content: result.content,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // delete_comment
  server.tool(
    'delete_comment',
    `Hard-delete a comment and all its replies (cascade). This cannot be undone.
Authors can delete their own comments; team members can delete any comment.

Examples:
- Delete: delete_comment({ commentId: "comment_01abc..." })`,
    deleteCommentSchema,
    DESTRUCTIVE,
    async (args: DeleteCommentArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      // No team role gate — the service layer allows comment authors OR team members
      try {
        await deleteComment(args.commentId as CommentId, {
          principalId: auth.principalId,
          role: auth.role,
        })

        return jsonResult({ deleted: true, commentId: args.commentId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // react_to_comment
  server.tool(
    'react_to_comment',
    `Add or remove an emoji reaction on a comment.

Examples:
- Add reaction: react_to_comment({ action: "add", commentId: "comment_01abc...", emoji: "👍" })
- Remove reaction: react_to_comment({ action: "remove", commentId: "comment_01abc...", emoji: "👍" })`,
    reactToCommentSchema,
    WRITE,
    async (args: ReactToCommentArgs): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback')
      if (denied) return denied
      try {
        const result =
          args.action === 'add'
            ? await addReaction(args.commentId as CommentId, args.emoji, auth.principalId)
            : await removeReaction(args.commentId as CommentId, args.emoji, auth.principalId)

        return jsonResult({
          commentId: args.commentId,
          emoji: args.emoji,
          added: result.added,
          reactions: result.reactions,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_roadmap_post
  server.tool(
    'manage_roadmap_post',
    `Add or remove a post from a roadmap.

Examples:
- Add: manage_roadmap_post({ action: "add", roadmapId: "roadmap_01abc...", postId: "post_01xyz..." })
- Remove: manage_roadmap_post({ action: "remove", roadmapId: "roadmap_01abc...", postId: "post_01xyz..." })`,
    manageRoadmapPostSchema,
    WRITE,
    async (args: ManageRoadmapPostArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        if (args.action === 'add') {
          await addPostToRoadmap(
            {
              postId: args.postId as PostId,
              roadmapId: args.roadmapId as RoadmapId,
            },
            auth.principalId
          )
        } else {
          await removePostFromRoadmap(
            args.postId as PostId,
            args.roadmapId as RoadmapId,
            auth.principalId
          )
        }

        return jsonResult({
          action: args.action,
          postId: args.postId,
          roadmapId: args.roadmapId,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // merge_post
  server.tool(
    'merge_post',
    `Merge a duplicate post into a canonical post. Aggregates votes. Reversible via unmerge_post.

Examples:
- Merge: merge_post({ duplicatePostId: "post_01dup...", canonicalPostId: "post_01canon..." })`,
    mergePostSchema,
    WRITE,
    async (args: MergePostArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const result = await mergePost(
          args.duplicatePostId as PostId,
          args.canonicalPostId as PostId,
          auth.principalId
        )

        return jsonResult({
          canonicalPost: result.canonicalPost,
          duplicatePost: result.duplicatePost,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // unmerge_post
  server.tool(
    'unmerge_post',
    `Restore a merged post to independent state. Recalculates vote counts.

Examples:
- Unmerge: unmerge_post({ postId: "post_01merged..." })`,
    unmergePostSchema,
    WRITE,
    async (args: UnmergePostArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const result = await unmergePost(args.postId as PostId, auth.principalId)

        return jsonResult({
          post: result.post,
          canonicalPost: result.canonicalPost,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // delete_post
  server.tool(
    'delete_post',
    `Soft-delete a feedback post. The post is hidden from public views but can be restored within 30 days.

Examples:
- Delete: delete_post({ postId: "post_01abc..." })`,
    deletePostSchema,
    DESTRUCTIVE,
    async (args: DeletePostArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        await softDeletePost(args.postId as PostId, {
          principalId: auth.principalId,
          role: auth.role,
        })

        return jsonResult({ deleted: true, postId: args.postId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // restore_post
  server.tool(
    'restore_post',
    `Restore a soft-deleted post. Posts can only be restored within 30 days of deletion.

Examples:
- Restore: restore_post({ postId: "post_01abc..." })`,
    restorePostSchema,
    WRITE,
    async (args: RestorePostArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const result = await restorePost(args.postId as PostId, auth.principalId)

        return jsonResult({ restored: true, postId: args.postId, title: result.title })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // list_suggestions
  server.tool(
    'list_suggestions',
    `List AI-generated feedback suggestions. Suggestions are created when feedback is ingested from external sources (Slack, email, etc.) and processed by the AI pipeline.

Types:
- create_post: AI suggests creating a new post from extracted feedback
- vote_on_post: AI suggests adding a vote to an existing similar post
- duplicate_post: AI detected two existing posts that may be duplicates

Examples:
- List pending: list_suggestions()
- Filter by type: list_suggestions({ suggestionType: "create_post" })
- Show dismissed: list_suggestions({ status: "dismissed" })`,
    listSuggestionsSchema,
    READ_ONLY,
    async (args: ListSuggestionsArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'read:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const { listSuggestions } = await import('@/lib/server/domains/feedback/suggestion.query')

        const decoded = decodeSearchCursor(args.cursor)
        const offset =
          typeof decoded.value === 'number'
            ? decoded.value
            : parseInt(String(decoded.value), 10) || 0

        const result = await listSuggestions({
          status: args.status,
          suggestionType: args.suggestionType,
          sort: args.sort,
          limit: args.limit,
          offset,
        })

        const nextCursor = result.hasMore
          ? encodeSearchCursor('suggestions', offset + args.limit)
          : null

        return jsonResult({
          suggestions: result.items,
          total: result.total,
          countsBySource: result.countsBySource,
          nextCursor,
          hasMore: result.hasMore,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // accept_suggestion
  server.tool(
    'accept_suggestion',
    `Accept an AI-generated suggestion. Behavior depends on the suggestion type:
- create_post: Creates a new post from the extracted feedback. Optional edits can override the suggested title/body/board.
- vote_on_post: Adds a proxy vote to the matched existing post.
- duplicate_post: Merges the source post into the target post. Use swapDirection to reverse which post is kept.

Examples:
- Accept as-is: accept_suggestion({ id: "feedback_suggestion_01abc..." })
- Accept with edits: accept_suggestion({ id: "feedback_suggestion_01abc...", edits: { title: "Better title" } })
- Accept merge: accept_suggestion({ id: "merge_sug_01abc..." })
- Accept merge swapped: accept_suggestion({ id: "merge_sug_01abc...", swapDirection: true })`,
    acceptSuggestionSchema,
    WRITE,
    async (args: AcceptSuggestionArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        // Route to merge suggestion handler
        if (isTypeId(args.id, 'merge_sug')) {
          await acceptMergeSuggestion(args.id as MergeSuggestionId, auth.principalId, {
            swapDirection: args.swapDirection,
          })
          return jsonResult({ accepted: true, id: args.id })
        }

        // Validate feedback suggestion ID
        if (!isValidTypeId(args.id, 'feedback_suggestion')) {
          return errorResult(
            new Error(
              'Invalid suggestion ID. Expected feedback_suggestion_xxx or merge_sug_xxx format.'
            )
          )
        }

        const suggestionId = args.id as FeedbackSuggestionId

        // Look up suggestion to determine type
        const { db, feedbackSuggestions, eq } = await import('@/lib/server/db')
        const suggestion = await db.query.feedbackSuggestions.findFirst({
          where: eq(feedbackSuggestions.id, suggestionId),
          columns: { id: true, suggestionType: true, status: true },
        })

        if (!suggestion || suggestion.status !== 'pending') {
          return errorResult(new Error('Suggestion not found or already resolved'))
        }

        // vote_on_post with no edits → proxy vote
        if (suggestion.suggestionType === 'vote_on_post' && !args.edits) {
          const result = await acceptVoteSuggestion(suggestionId, auth.principalId)
          return jsonResult({
            accepted: true,
            id: args.id,
            resultPostId: result.resultPostId,
          })
        }

        // create_post or vote_on_post with edits → create post
        const result = await acceptCreateSuggestion(suggestionId, auth.principalId, args.edits)
        return jsonResult({
          accepted: true,
          id: args.id,
          resultPostId: result.resultPostId,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // dismiss_suggestion
  server.tool(
    'dismiss_suggestion',
    `Dismiss an AI-generated suggestion. The suggestion can be restored later via restore_suggestion.

Examples:
- Dismiss: dismiss_suggestion({ id: "feedback_suggestion_01abc..." })
- Dismiss merge: dismiss_suggestion({ id: "merge_sug_01abc..." })`,
    dismissSuggestionSchema,
    WRITE,
    async (args: DismissSuggestionArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        if (isTypeId(args.id, 'merge_sug')) {
          await dismissMergeSuggestion(args.id as MergeSuggestionId, auth.principalId)
          return jsonResult({ dismissed: true, id: args.id })
        }

        if (!isValidTypeId(args.id, 'feedback_suggestion')) {
          return errorResult(
            new Error(
              'Invalid suggestion ID. Expected feedback_suggestion_xxx or merge_sug_xxx format.'
            )
          )
        }

        await dismissFeedbackSuggestion(args.id as FeedbackSuggestionId, auth.principalId)
        return jsonResult({ dismissed: true, id: args.id })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // restore_suggestion
  server.tool(
    'restore_suggestion',
    `Restore a dismissed suggestion back to pending status.

Examples:
- Restore: restore_suggestion({ id: "feedback_suggestion_01abc..." })
- Restore merge: restore_suggestion({ id: "merge_sug_01abc..." })`,
    restoreSuggestionSchema,
    WRITE,
    async (args: RestoreSuggestionArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        if (isTypeId(args.id, 'merge_sug')) {
          await restoreMergeSuggestion(args.id as MergeSuggestionId, auth.principalId)
          return jsonResult({ restored: true, id: args.id })
        }

        if (!isValidTypeId(args.id, 'feedback_suggestion')) {
          return errorResult(
            new Error(
              'Invalid suggestion ID. Expected feedback_suggestion_xxx or merge_sug_xxx format.'
            )
          )
        }

        await restoreFeedbackSuggestion(args.id as FeedbackSuggestionId, auth.principalId)
        return jsonResult({ restored: true, id: args.id })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_post_activity
  server.tool(
    'get_post_activity',
    `Get the activity log for a post. Shows status changes, merges, tag changes, owner assignments, proxy votes, and other events.

Examples:
- Get activity: get_post_activity({ postId: "post_01abc..." })`,
    getPostActivitySchema,
    READ_ONLY,
    async (args: GetPostActivityArgs): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'read:feedback')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const activities = await getActivityForPost(args.postId as PostId)

        return jsonResult({
          postId: args.postId,
          activities: activities.map((a) => ({
            id: a.id,
            type: a.type,
            actorName: a.actorName,
            metadata: a.metadata,
            createdAt: a.createdAt,
          })),
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
  // The cursor value is a PostId string from the previous page's last item
  const cursorValue = typeof decoded.value === 'string' ? decoded.value : undefined

  const result = await listInboxPosts({
    search: args.query,
    boardIds: args.boardId ? [args.boardId as BoardId] : undefined,
    statusSlugs: args.status ? [args.status] : undefined,
    tagIds: args.tagIds as TagId[] | undefined,
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
      excerpt: p.content
        ? p.content.length > 200
          ? p.content.slice(0, 200) + '...'
          : p.content
        : '',
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
      excerpt: c.content
        ? c.content.length > 200
          ? c.content.slice(0, 200) + '...'
          : c.content
        : '',
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
  const [post, comments, mergedPosts] = await Promise.all([
    getPostWithDetails(postId),
    getCommentsWithReplies(postId),
    getMergedPosts(postId),
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
