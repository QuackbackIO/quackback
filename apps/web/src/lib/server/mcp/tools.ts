/**
 * MCP Tools for Quackback
 *
 * 27 tools calling domain services directly (no HTTP self-loop):
 * - search: Unified search across posts, changelogs, and articles
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
 * - create_article: Create a help center article (draft)
 * - update_article: Update or publish/unpublish an article
 * - delete_article: Soft-delete an article
 * - manage_category: Create, update, or delete a help center category
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { getPostWithDetails, getCommentsWithReplies } from '@/lib/server/domains/posts/post.query'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
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
import { createComment, deleteComment } from '@/lib/server/domains/comments/comment.service'
import { userEditComment } from '@/lib/server/domains/comments/comment.permissions'
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
import { getTypeIdPrefix, isTypeId, isValidTypeId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { truncate } from '@/lib/shared/utils/string'
import {
  listArticles,
  getArticleById,
  getCategoryById,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  createCategory,
  updateCategory,
  deleteCategory,
} from '@/lib/server/domains/help-center/help-center.service'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { DomainException } from '@/lib/shared/errors'
import { parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import {
  createTicket,
  updateTicket,
  assignTicket,
  transitionStatus,
  getTicket,
} from '@/lib/server/domains/tickets/ticket.service'
import { listTickets, type TicketQueueScope } from '@/lib/server/domains/tickets/ticket.query'
import { takeTicket, returnTicket } from '@/lib/server/domains/tickets/ticket.take-return'
import {
  bulkAssign,
  bulkTransition,
  bulkChangeInbox,
} from '@/lib/server/domains/tickets/ticket.bulk'
import {
  getTicketStatus,
  listTicketStatuses,
  createTicketStatus,
  updateTicketStatus,
  archiveTicketStatus,
} from '@/lib/server/domains/tickets/ticket-statuses.service'
import {
  searchContacts,
  getContact,
  createContact,
  updateContact,
  archiveContact,
  findOrCreateByEmail as findOrCreateContactByEmail,
  linkContactToUser,
  unlinkContactFromUser,
  listLinksForContact,
  listContactsForOrganization,
} from '@/lib/server/domains/organizations/contact.service'
import {
  listOrganizations,
  getOrganization,
  getOrganizationByDomain,
  createOrganization,
  updateOrganization,
  archiveOrganization,
  unarchiveOrganization,
} from '@/lib/server/domains/organizations/organization.service'
import {
  addThread,
  editThread,
  softDeleteThread,
  listThreads,
} from '@/lib/server/domains/tickets/ticket.threads'
import {
  addParticipant,
  removeParticipant,
  listParticipants,
} from '@/lib/server/domains/tickets/ticket.participants'
import {
  shareTicketWithTeam,
  revokeShare,
  listSharesForTicket,
} from '@/lib/server/domains/tickets/ticket.share'
import {
  safeSubscribe,
  unsubscribeFromTicket,
  updateSubscriptionPrefs,
} from '@/lib/server/domains/tickets/ticket.subscriptions'
import {
  toResourceScope,
  canViewTicket,
  canReplyPublic,
  canCommentInternal,
  canShareCrossTeam,
  canManageParticipants,
} from '@/lib/server/domains/tickets/ticket.permissions'
import {
  loadPermissionSet,
  hasPermission,
  hasPermissionForResource,
} from '@/lib/server/domains/authz/authz.service'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  TICKET_PRIORITIES,
  TICKET_CHANNELS,
  TICKET_VISIBILITY_SCOPES,
  TICKET_STATUS_CATEGORIES,
  TICKET_THREAD_AUDIENCES,
  TICKET_PARTICIPANT_ROLES,
  TICKET_SHARE_LEVELS,
} from '@/lib/server/db'
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
  HelpCenterArticleId,
  HelpCenterCategoryId,
  TicketId,
  TicketStatusId,
  TicketThreadId,
  TicketShareId,
  TicketParticipantId,
  TeamId,
  ContactId,
  UserId,
  OrganizationId,
  InboxId,
} from '@quackback/ids'

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
  let message: string
  if (err instanceof DomainException) {
    message = `${err.message} (code: ${err.code})`
  } else if (err instanceof Error) {
    message = err.message
  } else {
    message = 'Unknown error'
  }
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

/**
 * Scope superset map: a granted scope implicitly satisfies the scopes listed.
 * Keep relationships strictly tier-based (manage > write > read) and never
 * cross domain boundaries.
 */
const SCOPE_IMPLIES: Partial<Record<McpScope, readonly McpScope[]>> = {
  'write:feedback': ['read:feedback'],
  'write:help-center': ['read:help-center'],
  'manage:tickets': ['write:tickets', 'read:tickets'],
  'write:tickets': ['read:tickets'],
  'write:contacts': ['read:contacts'],
}

/** True when `granted` either equals `required` or transitively implies it. */
function scopeSatisfies(granted: McpScope, required: McpScope): boolean {
  if (granted === required) return true
  const implied = SCOPE_IMPLIES[granted]
  return !!implied && implied.includes(required)
}

/** Return an error if the token is missing a required scope (honouring implications). */
function requireScope(auth: McpAuthContext, scope: McpScope): CallToolResult | null {
  if (auth.scopes.some((s) => scopeSatisfies(s, scope))) return null
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

/** Return an error if the help center feature is disabled. */
async function requireHelpCenter(): Promise<CallToolResult | null> {
  if (await isFeatureEnabled('helpCenter')) return null
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Error: Help center is not enabled. Enable it in Settings > Features.',
      },
    ],
  }
}

/** Combined gate: feature flag + scope + team role for help center write tools. */
async function requireHelpCenterWrite(auth: McpAuthContext): Promise<CallToolResult | null> {
  return (
    (await requireHelpCenter()) ?? requireScope(auth, 'write:help-center') ?? requireTeamRole(auth)
  )
}

/** Format a help center article as a tool result. */
function articleResult(article: {
  id: string
  slug: string
  title: string
  content: string
  description: string | null
  position: number | null
  category: { id: string; slug: string; name: string }
  author: { id: string; name: string; avatarUrl: string | null } | null
  publishedAt: Date | null
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
  createdAt: Date
  updatedAt: Date
}): CallToolResult {
  return jsonResult({
    id: article.id,
    slug: article.slug,
    title: article.title,
    content: article.content,
    description: article.description,
    position: article.position,
    category: article.category,
    author: article.author,
    publishedAt: article.publishedAt,
    viewCount: article.viewCount,
    helpfulCount: article.helpfulCount,
    notHelpfulCount: article.notHelpfulCount,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  })
}

/** Format a help center category as a tool result. */
function categoryResult(category: {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  parentId: string | null
  isPublic: boolean
  position: number
  createdAt: Date
  updatedAt: Date
}): CallToolResult {
  return jsonResult({
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    icon: category.icon,
    parentId: category.parentId,
    isPublic: category.isPublic,
    position: category.position,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  })
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

/**
 * Shared "Content format" block appended to rich-content tool descriptions.
 * Kept as a single constant so the auto-rehost behavior stays DRY across
 * create_post / create_changelog / update_changelog / create_article / update_article.
 */
const CONTENT_FORMAT_BLOCK = `

Content format: GitHub-flavored Markdown (GFM).
Supported: headings (#, ##, ###), bold/italic/strikethrough, links, ordered/bulleted lists, task lists (- [ ]), inline and fenced code blocks with language hints, blockquotes, tables, horizontal rules, images.
Images: \`![alt](https://...)\`. External URLs are fetched server-side and re-uploaded to workspace storage on save (auto-rehost). Supported image types: PNG, JPEG, WebP, GIF, AVIF. Max 10 MB per image, max 20 images per save. Images exceeding these limits keep their original URL as a fallback.
Example: "## New feature\\n\\nAdds **dark mode**. See screenshot:\\n\\n![dark mode](https://example.com/dark.png)"`

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
  content: z
    .string()
    .max(5000)
    .describe(
      'Comment text. Plain text only (max 5,000 characters). Rich content, markdown, and image embedding are not supported for comments today.'
    ),
  parentId: z.string().optional().describe('Parent comment TypeID for threaded reply'),
  isPrivate: z
    .boolean()
    .optional()
    .describe('If true, comment is an internal note visible only to team members'),
}

const createPostSchema = {
  boardId: z.string().describe('Board TypeID (use quackback://boards resource to find IDs)'),
  title: z.string().max(200).describe('Post title (max 200 characters)'),
  content: z
    .string()
    .max(10000)
    .optional()
    .describe(
      'Post content (max 10,000 characters). Markdown (GFM). Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
    ),
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
    .describe(
      'Changelog content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
    ),
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
    .describe(
      'New content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
    ),
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
  content: z
    .string()
    .max(5000)
    .describe(
      'New comment text. Plain text only (max 5,000 characters). Rich content, markdown, and image embedding are not supported for comments today.'
    ),
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

const createHelpCenterArticleSchema = {
  categoryId: z
    .string()
    .describe('Category TypeID (use quackback://help-center/categories resource to find IDs)'),
  title: z.string().max(200).describe('Article title (max 200 characters)'),
  content: z
    .string()
    .max(50000)
    .describe(
      'Article content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
    ),
  slug: z.string().max(200).optional().describe('URL slug (auto-generated from title if omitted)'),
  description: z
    .string()
    .max(300)
    .optional()
    .describe('Short page description for SEO and article previews (max 300 chars)'),
  authorId: z
    .string()
    .optional()
    .describe('Principal TypeID of the article author (defaults to the authenticated caller)'),
}

const updateHelpCenterArticleSchema = {
  articleId: z.string().describe('Article TypeID to update'),
  title: z.string().max(200).optional().describe('New title'),
  content: z
    .string()
    .max(50000)
    .optional()
    .describe(
      'New content. Markdown (GFM), max 50,000 chars. Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
    ),
  slug: z.string().max(200).optional().describe('New URL slug'),
  description: z.string().max(300).optional().describe('New page description (max 300 chars)'),
  categoryId: z.string().optional().describe('Move to a different category TypeID'),
  publishedAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe(
      'Any ISO 8601 datetime string to publish immediately (e.g. "2026-04-08T00:00:00Z"), or null to unpublish. The exact timestamp is not used — articles are always published at the current time.'
    ),
  authorId: z.string().optional().describe('Principal TypeID to reassign as the article author'),
}

const deleteHelpCenterArticleSchema = {
  articleId: z.string().describe('Article TypeID to delete'),
}

const manageCategorySchema = {
  action: z.enum(['create', 'update', 'delete']).describe('Operation to perform'),
  categoryId: z.string().optional().describe('Category TypeID (required for update and delete)'),
  name: z.string().max(200).optional().describe('Category name (required for create)'),
  slug: z.string().max(200).optional().describe('URL slug'),
  description: z.string().max(2000).nullable().optional().describe('Category description'),
  icon: z.string().max(50).nullable().optional().describe('Emoji icon (e.g. "🚀")'),
  parentId: z
    .string()
    .nullable()
    .optional()
    .describe('Parent category TypeID, or null for top-level'),
  isPublic: z.boolean().optional().describe('Whether category is publicly visible'),
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

type CreateHelpCenterArticleArgs = {
  categoryId: string
  title: string
  content: string
  slug?: string
  description?: string
  authorId?: string
}

type UpdateHelpCenterArticleArgs = {
  articleId: string
  title?: string
  content?: string
  slug?: string
  description?: string
  categoryId?: string
  publishedAt?: string | null
  authorId?: string
}

type DeleteHelpCenterArticleArgs = { articleId: string }

type ManageCategoryArgs = {
  action: 'create' | 'update' | 'delete'
  categoryId?: string
  name?: string
  slug?: string
  description?: string | null
  icon?: string | null
  parentId?: string | null
  isPublic?: boolean
}

// ============================================================================
// Tool registration
// ============================================================================

export function registerTools(server: McpServer, auth: McpAuthContext) {
  // search
  server.tool(
    'search',
    `Search feedback posts, changelog entries, or help center articles. Returns paginated results with a cursor for fetching more.

Examples:
- Search all posts: search()
- Search by text: search({ query: "dark mode" })
- Filter by board and status: search({ boardId: "board_01abc...", status: "open" })
- Search changelogs: search({ entity: "changelogs", status: "published" })
- Search articles: search({ entity: "articles", query: "getting started" })
- Filter articles by category: search({ entity: "articles", categoryId: "category_01abc..." })
- Sort by votes: search({ sort: "votes", limit: 10 })`,
    searchSchema,
    READ_ONLY,
    async (args: SearchArgs): Promise<CallToolResult> => {
      if (args.entity === 'articles') {
        const flagDenied = await requireHelpCenter()
        if (flagDenied) return flagDenied
        const denied = requireScope(auth, 'read:help-center')
        if (denied) return denied
        // Help-center MCP read surfaces unpublished drafts and articles
        // under categories an admin marked private. The public help
        // center site already serves the published+isPublic slice for
        // anonymous and portal users; gating MCP read on team role
        // matches the team-only intent of the inbox-style tools.
        const roleDenied = requireTeamRole(auth)
        if (roleDenied) return roleDenied
        try {
          return await searchArticles(args)
        } catch (err) {
          return errorResult(err)
        }
      }

      const denied = requireScope(auth, 'read:feedback')
      if (denied) return denied
      // Posts and changelogs inbox-style listings expose pending /
      // soft-deleted / draft / scheduled content alongside published
      // rows. Gating these on team role keeps OAuth portal users out
      // of the admin moderation surface.
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
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
- Get a changelog: get_details({ id: "changelog_01xyz..." })
- Get an article: get_details({ id: "article_01abc..." })
- Get a category: get_details({ id: "category_01abc..." })`,
    getDetailsSchema,
    READ_ONLY,
    async (args: GetDetailsArgs): Promise<CallToolResult> => {
      try {
        let prefix: string
        try {
          prefix = getTypeIdPrefix(args.id)
        } catch {
          return errorResult(
            new Error(
              `Invalid TypeID format: "${args.id}". Expected format: prefix_base32suffix (e.g., post_01abc..., article_01abc...)`
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
            return await getPostDetails(args.id as PostId)
          }
          case 'changelog': {
            const denied = requireScope(auth, 'read:feedback')
            if (denied) return denied
            // get_details returns the raw entry including drafts /
            // scheduled rows. Team-only matches the search gate.
            const roleDenied = requireTeamRole(auth)
            if (roleDenied) return roleDenied
            return await getChangelogDetails(args.id as ChangelogId)
          }
          case 'article': {
            const flagDenied = await requireHelpCenter()
            if (flagDenied) return flagDenied
            const denied = requireScope(auth, 'read:help-center')
            if (denied) return denied
            // getArticleById doesn't enforce publishedAt or
            // category.isPublic — so a portal user with the help-center
            // OAuth scope could fetch drafts or private-category
            // articles. The public help-center site has its own
            // unauthenticated path for the published slice.
            const roleDenied = requireTeamRole(auth)
            if (roleDenied) return roleDenied
            return await getArticleDetails(args.id as HelpCenterArticleId)
          }
          case 'category': {
            const flagDenied = await requireHelpCenter()
            if (flagDenied) return flagDenied
            const denied = requireScope(auth, 'read:help-center')
            if (denied) return denied
            // getCategoryById returns private categories too — keep
            // symmetric with the article path.
            const roleDenied = requireTeamRole(auth)
            if (roleDenied) return roleDenied
            return await getCategoryDetails(args.id as HelpCenterCategoryId)
          }
          default:
            return errorResult(
              new Error(
                `Unsupported entity type: "${prefix}". Supported: post, changelog, article, category`
              )
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
        // Chokepoint: resolves the post + board, then runs canVotePost
        // (which composes canViewPost). Team API keys always pass the
        // tier check; this primarily enforces post.deletedAt /
        // board.deletedAt + per-board vote tier — protections that
        // voteOnPost alone skipped.
        const { assertPostVotable } = await import('@/lib/server/domains/posts/post.access')
        const { segmentIdsForPrincipal: resolveSegments } =
          await import('@/lib/server/domains/segments/segment-membership.service')
        const votingActor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: 'user' as const,
          segmentIds: await resolveSegments(auth.principalId),
        }
        await assertPostVotable(args.postId as PostId, votingActor)
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
      // Team-authority tool: records a vote on behalf of `voterPrincipalId`
      // (e.g. from a support ticket). It routes to addVoteOnBehalf and
      // deliberately does NOT run assertPostVotable — the per-board vote
      // tier gates a user voting for THEMSELVES, not a teammate attributing
      // signal gathered off-portal. Enforcing the target's tier would defeat
      // the feature (e.g. logging customer demand on a vote='team' roadmap).
      // Pinned by handler.test.ts "intentional team-attributed bypass".
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
        // MCP auth is admin/member-scoped; build a team-shaped actor so the
        // policy gate inside createComment reflects who is doing the write.
        const callerSegmentIds = await segmentIdsForPrincipal(auth.principalId)
        const mcpCommentActor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: callerSegmentIds,
        }
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
          },
          mcpCommentActor
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
- Full: create_post({ boardId: "board_01abc...", title: "Add dark mode", content: "Would love a dark theme option.", statusId: "status_01xyz...", tagIds: ["tag_01a..."] })${CONTENT_FORMAT_BLOCK}`,
    createPostSchema,
    WRITE,
    async (args: CreatePostArgs): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback')
      if (denied) return denied
      try {
        // Build a team-shaped actor from the caller's REAL role so the
        // policy gate inside createPost (submit tier + moderation axis)
        // reflects who is writing. Team API keys (role 'admin'/'member')
        // keep their legitimate bypass; portal users (role 'user') are
        // gated exactly as the portal create path gates them.
        const callerSegmentIds = await segmentIdsForPrincipal(auth.principalId)
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: callerSegmentIds,
        }

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
            actor,
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
- Backdated: create_changelog({ title: "v2.1 Release", content: "...", publishedAt: "2025-03-15T12:00:00Z" })${CONTENT_FORMAT_BLOCK}`,
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
- Link posts: update_changelog({ changelogId: "changelog_01abc...", linkedPostIds: ["post_01a...", "post_01b..."] })${CONTENT_FORMAT_BLOCK}`,
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
        // View-gate first: an author who can no longer view the comment's
        // board (tightened to team / dropped from a segment) must not edit
        // it via MCP, matching the portal path (functions/comments.ts).
        const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
        const callerSegmentIds = await segmentIdsForPrincipal(auth.principalId)
        await assertCommentViewable(args.commentId as CommentId, {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: callerSegmentIds,
        })
        const result = await userEditComment(args.commentId as CommentId, args.content, {
          principalId: auth.principalId,
          role: auth.role,
        })

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
        // View-gate before the irreversible cascade delete — same as the
        // portal path and react_to_comment.
        const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
        const callerSegmentIds = await segmentIdsForPrincipal(auth.principalId)
        await assertCommentViewable(args.commentId as CommentId, {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: callerSegmentIds,
        })
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
        // Build a team-shaped actor so the canViewPost + isPrivate
        // gates inside add/removeReaction reflect who is reacting.
        const callerSegmentIds = await segmentIdsForPrincipal(auth.principalId)
        const mcpReactionActor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: callerSegmentIds,
        }
        const result =
          args.action === 'add'
            ? await addReaction(
                args.commentId as CommentId,
                args.emoji,
                auth.principalId,
                mcpReactionActor
              )
            : await removeReaction(
                args.commentId as CommentId,
                args.emoji,
                auth.principalId,
                mcpReactionActor
              )

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

  // create_article
  server.tool(
    'create_article',
    `Create a new help center article (draft). Use update_article to publish it.

Examples:
- create_article({ categoryId: "category_01abc...", title: "Getting Started", content: "Welcome to..." })
- With custom slug: create_article({ categoryId: "category_01abc...", title: "FAQ", content: "...", slug: "frequently-asked-questions" })${CONTENT_FORMAT_BLOCK}`,
    createHelpCenterArticleSchema,
    WRITE,
    async (args: CreateHelpCenterArticleArgs): Promise<CallToolResult> => {
      const denied = await requireHelpCenterWrite(auth)
      if (denied) return denied
      try {
        const authorPrincipalId = parseOptionalTypeId<PrincipalId>(
          args.authorId,
          'principal',
          'author ID'
        )
        const article = await createArticle(
          {
            categoryId: args.categoryId,
            title: args.title,
            content: args.content,
            slug: args.slug,
            description: args.description,
          },
          auth.principalId,
          authorPrincipalId
        )

        return articleResult(article)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // update_article
  server.tool(
    'update_article',
    `Update a help center article. All fields optional — only provided fields change. Set publishedAt to any ISO datetime string to publish immediately, or null to unpublish.

Examples:
- Update title: update_article({ articleId: "article_01abc...", title: "New Title" })
- Publish: update_article({ articleId: "article_01abc...", publishedAt: "2026-04-08T00:00:00Z" })
- Unpublish: update_article({ articleId: "article_01abc...", publishedAt: null })${CONTENT_FORMAT_BLOCK}`,
    updateHelpCenterArticleSchema,
    WRITE,
    async (args: UpdateHelpCenterArticleArgs): Promise<CallToolResult> => {
      const denied = await requireHelpCenterWrite(auth)
      if (denied) return denied
      try {
        const authorPrincipalId = parseOptionalTypeId<PrincipalId>(
          args.authorId,
          'principal',
          'author ID'
        )

        const { articleId: _, publishedAt: __, authorId: ___, ...updateData } = args
        const hasUpdates =
          Object.values(updateData).some((v) => v !== undefined) || authorPrincipalId !== undefined

        // Validate + apply field/author updates first so a bad authorId
        // never leaves the article in a partially-published state.
        let article = null
        if (hasUpdates) {
          article = await updateArticle(
            args.articleId as HelpCenterArticleId,
            updateData,
            authorPrincipalId
          )
        }

        if (args.publishedAt !== undefined) {
          article =
            args.publishedAt === null
              ? await unpublishArticle(args.articleId as HelpCenterArticleId)
              : await publishArticle(args.articleId as HelpCenterArticleId)
        }

        if (!article) {
          article = await getArticleById(args.articleId as HelpCenterArticleId)
        }

        return articleResult(article)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // delete_article
  server.tool(
    'delete_article',
    `Soft-delete a help center article.

Example:
- delete_article({ articleId: "article_01abc..." })`,
    deleteHelpCenterArticleSchema,
    DESTRUCTIVE,
    async (args: DeleteHelpCenterArticleArgs): Promise<CallToolResult> => {
      const denied = await requireHelpCenterWrite(auth)
      if (denied) return denied
      try {
        await deleteArticle(args.articleId as HelpCenterArticleId)
        return jsonResult({ deleted: true, id: args.articleId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_category
  server.tool(
    'manage_category',
    `Create, update, or delete a help center category.

Examples:
- Create: manage_category({ action: "create", name: "Getting Started", icon: "🚀" })
- Update: manage_category({ action: "update", categoryId: "category_01abc...", name: "New Name" })
- Delete: manage_category({ action: "delete", categoryId: "category_01abc..." })`,
    manageCategorySchema,
    DESTRUCTIVE,
    async (args: ManageCategoryArgs): Promise<CallToolResult> => {
      const denied = await requireHelpCenterWrite(auth)
      if (denied) return denied
      try {
        switch (args.action) {
          case 'create': {
            if (!args.name) {
              return errorResult(new Error('name is required when action is "create"'))
            }
            const category = await createCategory({
              name: args.name,
              slug: args.slug,
              description: args.description ?? undefined,
              icon: args.icon ?? undefined,
              parentId: args.parentId ?? undefined,
              isPublic: args.isPublic,
            })
            return categoryResult(category)
          }
          case 'update': {
            if (!args.categoryId) {
              return errorResult(new Error('categoryId is required when action is "update"'))
            }
            const { action: _, categoryId: __, ...updateData } = args
            const category = await updateCategory(
              args.categoryId as HelpCenterCategoryId,
              updateData
            )
            return categoryResult(category)
          }
          case 'delete': {
            if (!args.categoryId) {
              return errorResult(new Error('categoryId is required when action is "delete"'))
            }
            await deleteCategory(args.categoryId as HelpCenterCategoryId)
            return jsonResult({ deleted: true, id: args.categoryId })
          }
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // Ticketing — Phase 2 lifecycle tools
  registerTicketTools(server, auth)
  // Ticketing status catalogue + CRM — Phase 4
  registerTicketStatusTools(server, auth)
  registerContactTools(server, auth)
  registerOrganizationTools(server, auth)
}

// ============================================================================
// Ticketing tool registrations (Phase 2)
// ============================================================================

const ticketIdSchema = z.string().min(1)
const ticketStatusIdSchema = z.string().min(1)
const ticketIdsSchema = z.array(ticketIdSchema).min(1).max(500)

const TICKET_QUEUE_SCOPES = [
  'all',
  'my_assigned',
  'my_team',
  'shared_with_me',
  'unassigned',
  'my_inbox',
  'inbox',
] as const satisfies readonly TicketQueueScope[]

/** Format a ticket row for MCP responses (omits the rich-text JSON to keep payloads small). */
function ticketResult(t: {
  id: string
  subject: string
  descriptionText: string | null
  priority: string
  channel: string
  visibilityScope: string
  statusId: string | null
  primaryTeamId: string | null
  assigneePrincipalId: string | null
  assigneeTeamId: string | null
  requesterPrincipalId: string | null
  requesterContactId: string | null
  organizationId: string | null
  inboxId: string | null
  slaPolicyId: string | null
  lastActivityAt: Date | null
  firstResponseAt?: Date | null
  resolvedAt?: Date | null
  closedAt?: Date | null
  reopenedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}): Record<string, unknown> {
  return {
    id: t.id,
    subject: t.subject,
    descriptionText: t.descriptionText,
    priority: t.priority,
    channel: t.channel,
    visibilityScope: t.visibilityScope,
    statusId: t.statusId,
    primaryTeamId: t.primaryTeamId,
    assigneePrincipalId: t.assigneePrincipalId,
    assigneeTeamId: t.assigneeTeamId,
    requesterPrincipalId: t.requesterPrincipalId,
    requesterContactId: t.requesterContactId,
    organizationId: t.organizationId,
    inboxId: t.inboxId,
    slaPolicyId: t.slaPolicyId,
    lastActivityAt: t.lastActivityAt,
    firstResponseAt: t.firstResponseAt ?? null,
    resolvedAt: t.resolvedAt ?? null,
    closedAt: t.closedAt ?? null,
    reopenedAt: t.reopenedAt ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

function registerTicketTools(server: McpServer, auth: McpAuthContext) {
  // list_tickets
  server.tool(
    'list_tickets',
    `List tickets in a queue. Permission-aware: the queue "scope" must be authorised by the caller's role.

Examples:
- My assigned: list_tickets({ scope: "my_assigned" })
- Open in my team: list_tickets({ scope: "my_team", statusCategory: "open" })
- Unassigned in an inbox: list_tickets({ scope: "unassigned", inboxId: "inbox_01..." })
- Search: list_tickets({ scope: "all", search: "login" })`,
    {
      scope: z.enum(TICKET_QUEUE_SCOPES).default('my_assigned'),
      statusCategory: z.enum(TICKET_STATUS_CATEGORIES).optional(),
      statusIds: z.array(ticketStatusIdSchema).optional(),
      inboxId: z.string().min(1).nullable().optional(),
      organizationId: z.string().min(1).nullable().optional(),
      requesterContactId: z.string().min(1).nullable().optional(),
      search: z.string().min(1).optional(),
      sort: z.enum(['last_activity_desc', 'created_desc', 'created_asc']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const permissionSet = await loadPermissionSet(auth.principalId)
        const result = await listTickets({
          scope: args.scope,
          permissionSet,
          statusCategory: args.statusCategory,
          statusIds: args.statusIds as TicketStatusId[] | undefined,
          inboxId: args.inboxId === undefined ? undefined : (args.inboxId as InboxId | null),
          organizationId:
            args.organizationId === undefined
              ? undefined
              : (args.organizationId as OrganizationId | null),
          requesterContactId:
            args.requesterContactId === undefined
              ? undefined
              : (args.requesterContactId as ContactId | null),
          search: args.search,
          sort: args.sort,
          limit: args.limit,
          offset: args.offset,
        })
        return compactJsonResult({
          tickets: result.rows.map(ticketResult),
          total: result.total,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_ticket
  server.tool(
    'get_ticket',
    `Get a ticket header plus its current status. Use list_ticket_threads (Phase 3) for the conversation.

Examples:
- get_ticket({ ticketId: "ticket_01..." })`,
    { ticketId: ticketIdSchema },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const ticket = await getTicket(args.ticketId as TicketId)
        if (!ticket) {
          return errorResult(new Error(`ticket ${args.ticketId} not found`))
        }
        const status = ticket.statusId
          ? await getTicketStatus(ticket.statusId as TicketStatusId)
          : null
        return jsonResult({
          ...ticketResult(ticket),
          status: status
            ? {
                id: status.id,
                slug: status.slug,
                name: status.name,
                category: status.category,
              }
            : null,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // create_ticket
  server.tool(
    'create_ticket',
    `Create a new ticket. Filed on behalf of the caller; supply requesterPrincipalId / requesterContactId to attribute the customer.

Examples:
- Minimal: create_ticket({ subject: "Login broken", descriptionText: "Cannot log in..." })
- With requester: create_ticket({ subject: "...", descriptionText: "...", requesterContactId: "contact_01..." })
- Routed to team: create_ticket({ subject: "...", descriptionText: "...", primaryTeamId: "team_01...", priority: "high" })`,
    {
      subject: z.string().min(1).max(500),
      descriptionText: z.string().min(1).max(100_000).optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      channel: z.enum(TICKET_CHANNELS).optional(),
      visibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
      statusId: ticketStatusIdSchema.optional(),
      primaryTeamId: z.string().min(1).optional(),
      assigneePrincipalId: z.string().min(1).optional(),
      assigneeTeamId: z.string().min(1).optional(),
      requesterPrincipalId: z.string().min(1).optional(),
      requesterContactId: z.string().min(1).optional(),
      organizationId: z.string().min(1).optional(),
      inboxId: z.string().min(1).optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const created = await createTicket({
          subject: args.subject,
          descriptionText: args.descriptionText ?? null,
          priority: args.priority,
          channel: args.channel,
          visibilityScope: args.visibilityScope,
          statusId: args.statusId as TicketStatusId | undefined,
          primaryTeamId: args.primaryTeamId as TeamId | undefined,
          assigneePrincipalId: args.assigneePrincipalId as PrincipalId | undefined,
          assigneeTeamId: args.assigneeTeamId as TeamId | undefined,
          requesterPrincipalId: args.requesterPrincipalId as PrincipalId | undefined,
          requesterContactId: args.requesterContactId as ContactId | undefined,
          organizationId: args.organizationId as OrganizationId | undefined,
          inboxId: args.inboxId as InboxId | undefined,
          createdByPrincipalId: auth.principalId,
        })
        return jsonResult(ticketResult(created))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // update_ticket
  server.tool(
    'update_ticket',
    `Update editable fields on a ticket. Reads current ticket internally for optimistic concurrency.

Examples:
- update_ticket({ ticketId: "ticket_01...", priority: "urgent" })
- update_ticket({ ticketId: "ticket_01...", subject: "...", visibilityScope: "team" })`,
    {
      ticketId: ticketIdSchema,
      subject: z.string().min(1).max(500).optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      visibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
      primaryTeamId: z.string().min(1).nullable().optional(),
      organizationId: z.string().min(1).nullable().optional(),
      requesterContactId: z.string().min(1).nullable().optional(),
      inboxId: z.string().min(1).nullable().optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const existing = await getTicket(args.ticketId as TicketId)
        if (!existing) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const updated = await updateTicket(args.ticketId as TicketId, {
          expectedUpdatedAt: existing.updatedAt,
          actorPrincipalId: auth.principalId,
          subject: args.subject,
          priority: args.priority,
          visibilityScope: args.visibilityScope,
          primaryTeamId:
            args.primaryTeamId === undefined ? undefined : (args.primaryTeamId as TeamId | null),
          organizationId:
            args.organizationId === undefined
              ? undefined
              : (args.organizationId as OrganizationId | null),
          requesterContactId:
            args.requesterContactId === undefined
              ? undefined
              : (args.requesterContactId as ContactId | null),
          inboxId: args.inboxId === undefined ? undefined : (args.inboxId as InboxId | null),
        })
        return jsonResult(ticketResult(updated))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // transition_ticket
  server.tool(
    'transition_ticket',
    `Move a ticket to a new status. Lifecycle timestamps (resolvedAt/closedAt/reopenedAt) are updated based on the destination category.

Examples:
- transition_ticket({ ticketId: "ticket_01...", statusId: "ticket_status_01..." })`,
    {
      ticketId: ticketIdSchema,
      statusId: ticketStatusIdSchema,
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const existing = await getTicket(args.ticketId as TicketId)
        if (!existing) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const updated = await transitionStatus(args.ticketId as TicketId, {
          expectedUpdatedAt: existing.updatedAt,
          actorPrincipalId: auth.principalId,
          statusId: args.statusId as TicketStatusId,
        })
        return jsonResult(ticketResult(updated))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // assign_ticket
  server.tool(
    'assign_ticket',
    `Assign or unassign a ticket. Pass null for assigneePrincipalId / assigneeTeamId to clear.

Examples:
- Assign to a person: assign_ticket({ ticketId: "ticket_01...", assigneePrincipalId: "principal_01..." })
- Assign to a team: assign_ticket({ ticketId: "ticket_01...", assigneeTeamId: "team_01..." })
- Unassign: assign_ticket({ ticketId: "ticket_01...", assigneePrincipalId: null, assigneeTeamId: null })`,
    {
      ticketId: ticketIdSchema,
      assigneePrincipalId: z.string().min(1).nullable().optional(),
      assigneeTeamId: z.string().min(1).nullable().optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const existing = await getTicket(args.ticketId as TicketId)
        if (!existing) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const updated = await assignTicket(args.ticketId as TicketId, {
          expectedUpdatedAt: existing.updatedAt,
          actorPrincipalId: auth.principalId,
          assigneePrincipalId:
            args.assigneePrincipalId === undefined
              ? undefined
              : (args.assigneePrincipalId as PrincipalId | null),
          assigneeTeamId:
            args.assigneeTeamId === undefined ? undefined : (args.assigneeTeamId as TeamId | null),
        })
        return jsonResult(ticketResult(updated))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // take_ticket
  server.tool(
    'take_ticket',
    `Assign a ticket to yourself.

Examples:
- take_ticket({ ticketId: "ticket_01..." })`,
    { ticketId: ticketIdSchema },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const updated = await takeTicket(args.ticketId as TicketId, auth.principalId)
        return jsonResult(ticketResult(updated))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // return_ticket
  server.tool(
    'return_ticket',
    `Unassign a ticket (clear assignee).

Examples:
- return_ticket({ ticketId: "ticket_01..." })`,
    { ticketId: ticketIdSchema },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const updated = await returnTicket(args.ticketId as TicketId, auth.principalId)
        return jsonResult(ticketResult(updated))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // bulk_assign_tickets
  server.tool(
    'bulk_assign_tickets',
    `Assign or unassign many tickets in one batch. Best-effort: returns succeeded/failed lists.

Examples:
- bulk_assign_tickets({ ticketIds: ["ticket_01...", "ticket_01..."], assigneePrincipalId: "principal_01..." })`,
    {
      ticketIds: ticketIdsSchema,
      assigneePrincipalId: z.string().min(1).nullable().optional(),
      assigneeTeamId: z.string().min(1).nullable().optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'manage:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const set = await loadPermissionSet(auth.principalId)
        const result = await bulkAssign({
          ticketIds: args.ticketIds as TicketId[],
          actorPrincipalId: auth.principalId,
          assigneePrincipalId:
            args.assigneePrincipalId === undefined
              ? undefined
              : (args.assigneePrincipalId as PrincipalId | null),
          assigneeTeamId:
            args.assigneeTeamId === undefined ? undefined : (args.assigneeTeamId as TeamId | null),
          permit: (scope) => hasPermissionForResource(set, PERMISSIONS.TICKET_ASSIGN_ANY, scope),
        })
        return jsonResult(result)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // bulk_transition_tickets
  server.tool(
    'bulk_transition_tickets',
    `Move many tickets to a new status. Best-effort.

Examples:
- bulk_transition_tickets({ ticketIds: ["ticket_01..."], statusId: "ticket_status_01..." })`,
    {
      ticketIds: ticketIdsSchema,
      statusId: ticketStatusIdSchema,
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'manage:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const set = await loadPermissionSet(auth.principalId)
        const result = await bulkTransition({
          ticketIds: args.ticketIds as TicketId[],
          actorPrincipalId: auth.principalId,
          statusId: args.statusId as TicketStatusId,
          permit: (scope) => hasPermissionForResource(set, PERMISSIONS.TICKET_EDIT_FIELDS, scope),
        })
        return jsonResult(result)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // bulk_change_inbox
  server.tool(
    'bulk_change_inbox',
    `Move many tickets to a different inbox (or clear with null). Best-effort.

Examples:
- bulk_change_inbox({ ticketIds: ["ticket_01..."], inboxId: "inbox_01..." })
- Clear inbox: bulk_change_inbox({ ticketIds: ["ticket_01..."], inboxId: null })`,
    {
      ticketIds: ticketIdsSchema,
      inboxId: z.string().min(1).nullable(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'manage:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const set = await loadPermissionSet(auth.principalId)
        const result = await bulkChangeInbox({
          ticketIds: args.ticketIds as TicketId[],
          actorPrincipalId: auth.principalId,
          inboxId: args.inboxId as InboxId | null,
          permit: (scope) => hasPermissionForResource(set, PERMISSIONS.TICKET_EDIT_FIELDS, scope),
        })
        return jsonResult(result)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // ==========================================================================
  // Phase 3 — threads / participants / shares / subscriptions / activity
  // ==========================================================================

  /** Build the ticket's resource scope for per-team permission checks. */
  const loadTicketResourceScope = async (ticketId: TicketId) => {
    const ticket = await getTicket(ticketId)
    if (!ticket) return null
    const shares = await listSharesForTicket(ticketId)
    return {
      ticket,
      scope: toResourceScope({
        primaryTeamId: ticket.primaryTeamId as TeamId | null,
        assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
        assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
        shares: shares.map((s) => ({
          teamId: s.teamId as TeamId,
          revokedAt: s.revokedAt,
        })),
      }),
    }
  }

  // list_ticket_threads
  server.tool(
    'list_ticket_threads',
    `List the threads (public replies, internal notes, shared-team notes) on a ticket. Internal notes are filtered out for callers without permission.

Examples:
- list_ticket_threads({ ticketId: "ticket_01..." })
- Include deleted: list_ticket_threads({ ticketId: "ticket_01...", includeDeleted: true })`,
    {
      ticketId: ticketIdSchema,
      includeDeleted: z.boolean().optional(),
    },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
        if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const set = await loadPermissionSet(auth.principalId)
        if (!canViewTicket(set, loaded.scope)) {
          return errorResult(new Error('cannot view this ticket'))
        }
        const rows = await listThreads(args.ticketId as TicketId, {
          viewerTeamIds: set.teamIds as TeamId[],
          canSeeInternal: canCommentInternal(set, loaded.scope),
          isRequester: loaded.ticket.requesterPrincipalId === auth.principalId,
          includeDeleted: args.includeDeleted,
        })
        return compactJsonResult({ threads: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // add_ticket_thread
  server.tool(
    'add_ticket_thread',
    `Post a reply on a ticket. Audience controls visibility:
- public: visible to the requester (counts toward first-response time)
- internal: agents only
- shared_team: only visible to the team named in sharedWithTeamId (requires an active share)

Examples:
- Public reply: add_ticket_thread({ ticketId: "ticket_01...", audience: "public", bodyText: "Looking into this now." })
- Internal note: add_ticket_thread({ ticketId: "ticket_01...", audience: "internal", bodyText: "Customer is on enterprise plan." })
- Shared note: add_ticket_thread({ ticketId: "ticket_01...", audience: "shared_team", bodyText: "...", sharedWithTeamId: "team_01..." })`,
    {
      ticketId: ticketIdSchema,
      audience: z.enum(TICKET_THREAD_AUDIENCES),
      bodyText: z.string().min(1).max(100_000),
      sharedWithTeamId: z.string().min(1).optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
        if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const set = await loadPermissionSet(auth.principalId)
        if (args.audience === 'public') {
          if (!canReplyPublic(set, loaded.scope)) {
            return errorResult(new Error('cannot post public replies on this ticket'))
          }
        } else if (args.audience === 'internal' || args.audience === 'shared_team') {
          if (!canCommentInternal(set, loaded.scope)) {
            return errorResult(new Error('cannot post internal/shared notes on this ticket'))
          }
        }
        const created = await addThread({
          ticketId: args.ticketId as TicketId,
          principalId: auth.principalId,
          audience: args.audience,
          bodyText: args.bodyText,
          sharedWithTeamId: (args.sharedWithTeamId as TeamId | undefined) ?? null,
        })
        return jsonResult(created)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // edit_ticket_thread
  server.tool(
    'edit_ticket_thread',
    `Edit a thread you authored. Cannot edit another user's thread.

Examples:
- edit_ticket_thread({ threadId: "ticket_thread_01...", bodyText: "Updated text." })`,
    {
      threadId: z.string().min(1),
      bodyText: z.string().min(1).max(100_000),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const updated = await editThread({
          threadId: args.threadId as TicketThreadId,
          actorPrincipalId: auth.principalId,
          bodyText: args.bodyText,
        })
        return jsonResult(updated)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // delete_ticket_thread
  server.tool(
    'delete_ticket_thread',
    `Soft-delete a thread. Soft-deleted threads are hidden from list_ticket_threads unless includeDeleted=true.

Examples:
- delete_ticket_thread({ threadId: "ticket_thread_01..." })`,
    { threadId: z.string().min(1) },
    DESTRUCTIVE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const updated = await softDeleteThread(args.threadId as TicketThreadId, auth.principalId)
        return jsonResult({ deleted: true, id: updated.id, deletedAt: updated.deletedAt })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // list_ticket_participants
  server.tool(
    'list_ticket_participants',
    `List the watchers / collaborators / CC'd contacts on a ticket.

Examples:
- list_ticket_participants({ ticketId: "ticket_01..." })`,
    { ticketId: ticketIdSchema },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
        if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const set = await loadPermissionSet(auth.principalId)
        if (!canViewTicket(set, loaded.scope)) {
          return errorResult(new Error('cannot view this ticket'))
        }
        const rows = await listParticipants(args.ticketId as TicketId)
        return compactJsonResult({ participants: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_ticket_participant
  server.tool(
    'manage_ticket_participant',
    `Add or remove a watcher / collaborator / CC on a ticket. Exactly one of principalId or contactId must be supplied for "add".

Examples:
- Add watcher (user): manage_ticket_participant({ action: "add", ticketId: "ticket_01...", role: "watcher", principalId: "principal_01..." })
- CC a contact: manage_ticket_participant({ action: "add", ticketId: "ticket_01...", role: "cc", contactId: "contact_01..." })
- Remove: manage_ticket_participant({ action: "remove", participantId: "ticket_participant_01..." })`,
    {
      action: z.enum(['add', 'remove']),
      ticketId: ticketIdSchema.optional(),
      role: z.enum(TICKET_PARTICIPANT_ROLES).optional(),
      principalId: z.string().min(1).optional(),
      contactId: z.string().min(1).optional(),
      participantId: z.string().min(1).optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        if (args.action === 'add') {
          if (!args.ticketId || !args.role) {
            return errorResult(new Error('ticketId and role are required for action "add"'))
          }
          const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
          if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
          const set = await loadPermissionSet(auth.principalId)
          if (!canManageParticipants(set, loaded.scope)) {
            return errorResult(new Error('cannot manage participants on this ticket'))
          }
          const created = await addParticipant({
            ticketId: args.ticketId as TicketId,
            role: args.role,
            principalId: (args.principalId as PrincipalId | undefined) ?? null,
            contactId: (args.contactId as ContactId | undefined) ?? null,
            addedByPrincipalId: auth.principalId,
          })
          return jsonResult(created)
        }
        // remove
        if (!args.participantId) {
          return errorResult(new Error('participantId is required for action "remove"'))
        }
        await removeParticipant(args.participantId as TicketParticipantId, auth.principalId)
        return jsonResult({ removed: true, id: args.participantId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // list_ticket_shares
  server.tool(
    'list_ticket_shares',
    `List active and revoked share grants on a ticket.

Examples:
- list_ticket_shares({ ticketId: "ticket_01..." })`,
    { ticketId: ticketIdSchema },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
        if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const set = await loadPermissionSet(auth.principalId)
        if (!canViewTicket(set, loaded.scope)) {
          return errorResult(new Error('cannot view this ticket'))
        }
        const rows = await listSharesForTicket(args.ticketId as TicketId)
        return compactJsonResult({ shares: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_ticket_share
  server.tool(
    'manage_ticket_share',
    `Grant or revoke a cross-team share on a ticket.

Examples:
- Grant: manage_ticket_share({ action: "grant", ticketId: "ticket_01...", teamId: "team_01...", accessLevel: "comment" })
- Revoke: manage_ticket_share({ action: "revoke", shareId: "ticket_share_01..." })`,
    {
      action: z.enum(['grant', 'revoke']),
      ticketId: ticketIdSchema.optional(),
      teamId: z.string().min(1).optional(),
      accessLevel: z.enum(TICKET_SHARE_LEVELS).optional(),
      shareId: z.string().min(1).optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'manage:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        if (args.action === 'grant') {
          if (!args.ticketId || !args.teamId) {
            return errorResult(new Error('ticketId and teamId are required for action "grant"'))
          }
          const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
          if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
          const set = await loadPermissionSet(auth.principalId)
          if (!canShareCrossTeam(set, loaded.scope)) {
            return errorResult(new Error('cannot share this ticket cross-team'))
          }
          const created = await shareTicketWithTeam({
            ticketId: args.ticketId as TicketId,
            teamId: args.teamId as TeamId,
            accessLevel: args.accessLevel,
            grantedByPrincipalId: auth.principalId,
          })
          return jsonResult(created)
        }
        // revoke
        if (!args.shareId) {
          return errorResult(new Error('shareId is required for action "revoke"'))
        }
        const updated = await revokeShare(args.shareId as TicketShareId, auth.principalId)
        return jsonResult(updated)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // subscribe_ticket
  server.tool(
    'subscribe_ticket',
    `Manage your (or another principal's) notification subscription for a ticket.
Defaults principalId to the caller. Subscribing another principal requires write:tickets.

Examples:
- Self subscribe: subscribe_ticket({ action: "subscribe", ticketId: "ticket_01..." })
- Self unsubscribe: subscribe_ticket({ action: "unsubscribe", ticketId: "ticket_01..." })
- Update prefs: subscribe_ticket({ action: "update_prefs", ticketId: "ticket_01...", notifyThreads: true, notifyStatus: false })`,
    {
      action: z.enum(['subscribe', 'unsubscribe', 'update_prefs']),
      ticketId: ticketIdSchema,
      principalId: z.string().min(1).optional(),
      notifyThreads: z.boolean().optional(),
      notifyStatus: z.boolean().optional(),
      notifyAssignment: z.boolean().optional(),
      notifyParticipants: z.boolean().optional(),
      notifyShares: z.boolean().optional(),
      notifySla: z.boolean().optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const target = (args.principalId as PrincipalId | undefined) ?? auth.principalId
      const isSelf = target === auth.principalId
      const required: McpScope = isSelf ? 'read:tickets' : 'write:tickets'
      const denied = requireScope(auth, required)
      if (denied) return denied
      try {
        if (args.action === 'subscribe') {
          await safeSubscribe({
            ticketId: args.ticketId as TicketId,
            principalId: target,
            source: 'manual',
          })
          return jsonResult({ subscribed: true, ticketId: args.ticketId, principalId: target })
        }
        if (args.action === 'unsubscribe') {
          const removed = await unsubscribeFromTicket(args.ticketId as TicketId, target)
          return jsonResult({
            unsubscribed: removed,
            ticketId: args.ticketId,
            principalId: target,
          })
        }
        // update_prefs
        const patch = {
          notifyThreads: args.notifyThreads,
          notifyStatus: args.notifyStatus,
          notifyAssignment: args.notifyAssignment,
          notifyParticipants: args.notifyParticipants,
          notifyShares: args.notifyShares,
          notifySla: args.notifySla,
        }
        const row = await updateSubscriptionPrefs({
          ticketId: args.ticketId as TicketId,
          principalId: target,
          patch,
          force: true,
        })
        return jsonResult(row)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_ticket_activity
  server.tool(
    'get_ticket_activity',
    `List ticket-activity events (status changes, assignments, threads, participants, shares) in reverse-chronological order. Use "before" (ISO date) for pagination.

Examples:
- get_ticket_activity({ ticketId: "ticket_01..." })
- Older page: get_ticket_activity({ ticketId: "ticket_01...", before: "2026-04-01T00:00:00Z", limit: 100 })`,
    {
      ticketId: ticketIdSchema,
      before: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
        if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const set = await loadPermissionSet(auth.principalId)
        if (!canViewTicket(set, loaded.scope)) {
          return errorResult(new Error('cannot view this ticket'))
        }
        const { listTicketActivity } = await import('@/lib/server/domains/tickets/ticket.activity')
        const rows = await listTicketActivity(args.ticketId as TicketId, {
          before: args.before ? new Date(args.before) : undefined,
          limit: args.limit,
        })
        return compactJsonResult({ activity: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Ticket status catalogue tools (Phase 4)
// ============================================================================

function registerTicketStatusTools(server: McpServer, auth: McpAuthContext) {
  // list_ticket_statuses
  server.tool(
    'list_ticket_statuses',
    `List the ticket workflow statuses (the workspace's status catalogue). Use the returned ids when calling create_ticket / transition_ticket.

Examples:
- list_ticket_statuses({})
- Include archived: list_ticket_statuses({ includeDeleted: true })`,
    { includeDeleted: z.boolean().optional() },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const rows = await listTicketStatuses({ includeDeleted: args.includeDeleted })
        return compactJsonResult({ statuses: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_ticket_status
  server.tool(
    'manage_ticket_status',
    `Create, update, or archive a ticket status. Requires manage:tickets scope AND admin.manage_settings permission.

Examples:
- Create: manage_ticket_status({ action: "create", name: "Waiting on customer", slug: "waiting_on_customer", category: "pending", color: "#f59e0b" })
- Update: manage_ticket_status({ action: "update", statusId: "ticket_status_01...", name: "In review", position: 3 })
- Archive (soft-delete): manage_ticket_status({ action: "archive", statusId: "ticket_status_01..." })`,
    {
      action: z.enum(['create', 'update', 'archive']),
      statusId: z.string().min(1).optional(),
      name: z.string().min(1).max(100).optional(),
      slug: z.string().min(1).max(100).optional(),
      color: z.string().min(1).optional(),
      category: z.enum(TICKET_STATUS_CATEGORIES).optional(),
      position: z.number().int().optional(),
      isDefault: z.boolean().optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'manage:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const set = await loadPermissionSet(auth.principalId)
        if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_SETTINGS)) {
          return errorResult(new Error('admin.manage_settings permission required'))
        }
        switch (args.action) {
          case 'create': {
            if (!args.name || !args.slug || !args.category) {
              return errorResult(
                new Error('name, slug, and category are required for action "create"')
              )
            }
            const created = await createTicketStatus(
              {
                name: args.name,
                slug: args.slug,
                category: args.category,
                color: args.color,
                position: args.position,
                isDefault: args.isDefault,
              },
              { principalId: auth.principalId }
            )
            return jsonResult(created)
          }
          case 'update': {
            if (!args.statusId) {
              return errorResult(new Error('statusId is required for action "update"'))
            }
            const updated = await updateTicketStatus(
              args.statusId as TicketStatusId,
              {
                name: args.name,
                color: args.color,
                category: args.category,
                position: args.position,
                isDefault: args.isDefault,
              },
              { principalId: auth.principalId }
            )
            return jsonResult(updated)
          }
          case 'archive': {
            if (!args.statusId) {
              return errorResult(new Error('statusId is required for action "archive"'))
            }
            const archived = await archiveTicketStatus(args.statusId as TicketStatusId, {
              principalId: auth.principalId,
            })
            return jsonResult(archived)
          }
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Contact tools (Phase 4)
// ============================================================================

function registerContactTools(server: McpServer, auth: McpAuthContext) {
  // search_contacts
  server.tool(
    'search_contacts',
    `Search contacts by name/email/external-id substring, by exact email, or filter by organization.

Examples:
- By query: search_contacts({ query: "acme" })
- By email: search_contacts({ email: "alice@acme.com" })
- By org: search_contacts({ organizationId: "organization_01...", limit: 100 })`,
    {
      query: z.string().min(1).optional(),
      email: z.string().min(1).optional(),
      organizationId: z.string().min(1).optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:contacts')
      if (denied) return denied
      try {
        const rows = await searchContacts({
          query: args.query,
          email: args.email,
          organizationId: args.organizationId as OrganizationId | undefined,
          includeArchived: args.includeArchived,
          limit: args.limit,
          offset: args.offset,
        })
        return compactJsonResult({ contacts: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_contact
  server.tool(
    'get_contact',
    `Fetch one contact along with the portal-user accounts linked to it.

Example: get_contact({ contactId: "contact_01..." })`,
    { contactId: z.string().min(1) },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:contacts')
      if (denied) return denied
      try {
        const contact = await getContact(args.contactId as ContactId)
        if (!contact) return errorResult(new Error(`contact ${args.contactId} not found`))
        const links = await listLinksForContact(args.contactId as ContactId)
        return jsonResult({ contact, links })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_contact
  server.tool(
    'manage_contact',
    `Create, update, archive, or upsert-by-email a contact.
"find_or_create_by_email" is concurrency-safe and idempotent — use it from intake/automation flows.

Examples:
- Create: manage_contact({ action: "create", name: "Alice", email: "alice@acme.com", organizationId: "organization_01..." })
- Update: manage_contact({ action: "update", contactId: "contact_01...", title: "VP Eng" })
- Archive: manage_contact({ action: "archive", contactId: "contact_01..." })
- Upsert: manage_contact({ action: "find_or_create_by_email", email: "bob@acme.com", name: "Bob" })`,
    {
      action: z.enum(['create', 'update', 'archive', 'find_or_create_by_email']),
      contactId: z.string().min(1).optional(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      externalId: z.string().nullable().optional(),
      organizationId: z.string().nullable().optional(),
      avatarUrl: z.string().nullable().optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:contacts')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        switch (args.action) {
          case 'create': {
            const created = await createContact({
              name: args.name,
              email: args.email,
              phone: args.phone,
              title: args.title,
              externalId: args.externalId,
              organizationId: args.organizationId as OrganizationId | null | undefined,
              avatarUrl: args.avatarUrl,
            })
            return jsonResult(created)
          }
          case 'update': {
            if (!args.contactId) {
              return errorResult(new Error('contactId is required for action "update"'))
            }
            const updated = await updateContact(args.contactId as ContactId, {
              name: args.name,
              email: args.email,
              phone: args.phone,
              title: args.title,
              externalId: args.externalId,
              organizationId: args.organizationId as OrganizationId | null | undefined,
              avatarUrl: args.avatarUrl,
            })
            return jsonResult(updated)
          }
          case 'archive': {
            if (!args.contactId) {
              return errorResult(new Error('contactId is required for action "archive"'))
            }
            await archiveContact(args.contactId as ContactId)
            return jsonResult({ archived: true, id: args.contactId })
          }
          case 'find_or_create_by_email': {
            if (!args.email) {
              return errorResult(
                new Error('email is required for action "find_or_create_by_email"')
              )
            }
            const contact = await findOrCreateContactByEmail({
              email: args.email,
              name: args.name,
              organizationId: args.organizationId as OrganizationId | null | undefined,
            })
            return jsonResult(contact)
          }
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // link_contact_user
  server.tool(
    'link_contact_user',
    `Link or unlink a portal-user account to a contact (N‑to‑N). "link" is idempotent.

Examples:
- Link: link_contact_user({ action: "link", contactId: "contact_01...", userId: "user_01..." })
- Unlink: link_contact_user({ action: "unlink", contactId: "contact_01...", userId: "user_01..." })`,
    {
      action: z.enum(['link', 'unlink']),
      contactId: z.string().min(1),
      userId: z.string().min(1),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:contacts')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        if (args.action === 'link') {
          const link = await linkContactToUser({
            contactId: args.contactId as ContactId,
            userId: args.userId as UserId,
            linkedByPrincipalId: auth.principalId,
          })
          return jsonResult(link)
        }
        await unlinkContactFromUser(args.contactId as ContactId, args.userId as UserId)
        return jsonResult({
          unlinked: true,
          contactId: args.contactId,
          userId: args.userId,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Organization tools (Phase 4)
// ============================================================================

function registerOrganizationTools(server: McpServer, auth: McpAuthContext) {
  // list_organizations
  server.tool(
    'list_organizations',
    `List customer organizations (B2B accounts). Optionally filter by name/domain substring.

Examples:
- list_organizations({})
- list_organizations({ search: "acme", limit: 100 })`,
    {
      search: z.string().min(1).optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:contacts')
      if (denied) return denied
      try {
        const rows = await listOrganizations({
          search: args.search,
          includeArchived: args.includeArchived,
          limit: args.limit,
          offset: args.offset,
        })
        return compactJsonResult({ organizations: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_organization
  server.tool(
    'get_organization',
    `Fetch one organization plus its contacts (capped at 50; use search_contacts for paging).

Example: get_organization({ organizationId: "organization_01..." })`,
    { organizationId: z.string().min(1) },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:contacts')
      if (denied) return denied
      try {
        const organization = await getOrganization(args.organizationId as OrganizationId)
        if (!organization) {
          return errorResult(new Error(`organization ${args.organizationId} not found`))
        }
        const contactsList = await listContactsForOrganization(
          args.organizationId as OrganizationId
        )
        return jsonResult({ organization, contacts: contactsList })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_organization
  server.tool(
    'manage_organization',
    `Create, update, archive, unarchive, or upsert-by-domain an organization.
"find_or_create_by_domain" looks up an org by normalized domain and creates it if missing.

Examples:
- Create: manage_organization({ action: "create", name: "Acme", domain: "acme.com" })
- Update: manage_organization({ action: "update", organizationId: "organization_01...", website: "https://acme.com" })
- Archive: manage_organization({ action: "archive", organizationId: "organization_01..." })
- Unarchive: manage_organization({ action: "unarchive", organizationId: "organization_01..." })
- Upsert: manage_organization({ action: "find_or_create_by_domain", domain: "acme.com" })`,
    {
      action: z.enum(['create', 'update', 'archive', 'unarchive', 'find_or_create_by_domain']),
      organizationId: z.string().min(1).optional(),
      name: z.string().min(1).max(200).optional(),
      domain: z.string().nullable().optional(),
      externalId: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    WRITE,
    async (args): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:contacts')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        switch (args.action) {
          case 'create': {
            if (!args.name) {
              return errorResult(new Error('name is required for action "create"'))
            }
            const created = await createOrganization({
              name: args.name,
              domain: args.domain,
              externalId: args.externalId,
              website: args.website,
              notes: args.notes,
            })
            return jsonResult(created)
          }
          case 'update': {
            if (!args.organizationId) {
              return errorResult(new Error('organizationId is required for action "update"'))
            }
            const updated = await updateOrganization(args.organizationId as OrganizationId, {
              name: args.name,
              domain: args.domain,
              externalId: args.externalId,
              website: args.website,
              notes: args.notes,
            })
            return jsonResult(updated)
          }
          case 'archive': {
            if (!args.organizationId) {
              return errorResult(new Error('organizationId is required for action "archive"'))
            }
            await archiveOrganization(args.organizationId as OrganizationId)
            return jsonResult({ archived: true, id: args.organizationId })
          }
          case 'unarchive': {
            if (!args.organizationId) {
              return errorResult(new Error('organizationId is required for action "unarchive"'))
            }
            await unarchiveOrganization(args.organizationId as OrganizationId)
            return jsonResult({ unarchived: true, id: args.organizationId })
          }
          case 'find_or_create_by_domain': {
            if (!args.domain) {
              return errorResult(
                new Error('domain is required for action "find_or_create_by_domain"')
              )
            }
            const existing = await getOrganizationByDomain(args.domain)
            if (existing) return jsonResult(existing)
            try {
              const created = await createOrganization({
                name: args.name ?? args.domain,
                domain: args.domain,
                externalId: args.externalId,
                website: args.website,
                notes: args.notes,
              })
              return jsonResult(created)
            } catch (err) {
              // Race recovery: a parallel caller may have just inserted the row.
              const after = await getOrganizationByDomain(args.domain)
              if (after) return jsonResult(after)
              throw err
            }
          }
        }
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

async function getArticleDetails(articleId: HelpCenterArticleId): Promise<CallToolResult> {
  const article = await getArticleById(articleId)
  return articleResult(article)
}

async function getCategoryDetails(categoryId: HelpCenterCategoryId): Promise<CallToolResult> {
  const category = await getCategoryById(categoryId)
  return categoryResult(category)
}
