/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * MCP Tools for Quackback
 *
 * 33 tools calling domain services directly (no HTTP self-loop):
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
 * - list_conversations: List support-inbox conversations
 * - get_conversation: Get a conversation and its messages
 * - reply_to_conversation: Send an agent reply in a conversation
 * - suggest_post: Nudge the team (agent-only) to track a resolved conversation as a post
 * - share_post: Embed an existing post as a card in the chat
 * - set_conversation_status: Change a conversation's status
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { getPostWithDetails, getCommentsWithReplies } from '@/lib/server/domains/posts/post.query'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
import {
  listSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
} from '@/lib/server/domains/segments/segment.service'
import {
  listUserAttributes,
  createUserAttribute,
  updateUserAttribute,
  deleteUserAttribute,
} from '@/lib/server/domains/user-attributes/user-attribute.service'
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
import {
  getOrgChangelogVisibility,
  setOrgChangelogVisibility,
  getAllSegmentChangelogVisibilities,
  getSegmentChangelogVisibility,
  setSegmentChangelogVisibility,
  deleteSegmentChangelogVisibility,
} from '@/lib/server/domains/changelog/changelog-visibility.service'
import { publishedAtToPublishState, type PublishState } from '@/lib/shared/schemas/changelog'
import {
  getOrgPortalTabConfig,
  setOrgPortalTabConfig,
  getSegmentTabOverrides,
  setSegmentTabOverrides,
  deleteSegmentTabOverrides,
  getAllSegmentTabOverrides,
} from '@/lib/server/domains/portal/portal-tab.service'
import type { PortalTabConfig } from '@/lib/server/domains/portal/types'
import {
  listWidgetApplications,
  upsertWidgetApplication,
  upsertWidgetEnvironmentProfile,
} from '@/lib/server/domains/widget-profiles/widget-profile.service'
import {
  addPostToRoadmap,
  removePostFromRoadmap,
  createRoadmap,
  updateRoadmap,
  deleteRoadmap,
  reorderRoadmaps,
} from '@/lib/server/domains/roadmaps/roadmap.service'
import { createBoard, updateBoard, deleteBoard } from '@/lib/server/domains/boards/board.service'
import { createTag, updateTag, deleteTag } from '@/lib/server/domains/tags/tag.service'
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  archiveTeam,
  unarchiveTeam,
  listMembers as listTeamMembers,
  addMember as addTeamMember,
  removeMember as removeTeamMember,
} from '@/lib/server/domains/teams/team.service'
import {
  listRoles,
  getRoleWithPermissions,
  createRole,
  updateRole,
  deleteRole,
  setRolePermissions,
  assignRole,
  revokeRoleAssignment,
  listAssignmentsForPrincipal,
} from '@/lib/server/domains/authz/role.service'
import {
  ALL_PERMISSIONS,
  PERMISSION_CATEGORIES,
} from '@/lib/server/domains/authz/authz.permissions'
import {
  createStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
  setDefaultStatus,
} from '@/lib/server/domains/statuses/status.service'
import { getTypeIdPrefix, isTypeId, isValidTypeId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { CONVERSATION_STATUSES, CONVERSATION_PRIORITIES } from '@/lib/shared/db-types'
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
  getThread,
} from '@/lib/server/domains/tickets/ticket.threads'
import {
  attachToThread,
  listForThread as listAttachmentsForThread,
  removeAttachment,
} from '@/lib/server/domains/tickets/ticket.attachments'
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
  canEditFields,
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
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'
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
  TicketAttachmentId,
  TicketShareId,
  TicketParticipantId,
  TeamId,
  ContactId,
  UserId,
  OrganizationId,
  InboxId,
  RoutingRuleId,
  ConversationId,
  SegmentId,
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
  'write:config': ['read:config'],
  'manage:admin': ['read:admin'],
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
  return (await requireHelpCenter()) ?? requireScope(auth, 'write:article') ?? requireTeamRole(auth)
}

/** Build the agent-author object used by the chat write tools (reply, suggest, share). */
function agentFromMcpAuth(auth: McpAuthContext) {
  return { principalId: auth.principalId, displayName: auth.name, email: auth.email }
}

/** Format a help center article as a tool result. */
function articleResult(article: {
  id: string
  slug: string
  title: string
  content: string
  contentJson: TiptapContent | null
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
    content: contentJsonToMarkdown(article.contentJson, article.content),
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
  visibility: 'public' | 'targeted'
  allowedSegmentIds: string[]
  allowedPrincipalIds: string[]
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
    visibility: category.visibility,
    allowedSegmentIds: category.allowedSegmentIds,
    allowedPrincipalIds: category.allowedPrincipalIds,
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
  categoryName: z.string().max(200).optional().describe('Changelog category name'),
  productName: z.string().max(200).optional().describe('Product name for this changelog entry'),
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
      'ISO 8601 datetime for publish/schedule lifecycle (e.g. "2025-03-15T12:00:00Z"). Future dates schedule; past dates publish immediately. For display-only backdating on published entries, use displayDate instead.'
    ),
  displayDate: z
    .string()
    .nullable()
    .optional()
    .describe(
      'ISO 8601 portal display override for published entries. Null clears the override. Must not be in the future.'
    ),
  linkedPostIds: z
    .array(z.string())
    .optional()
    .describe('Replace linked posts with these post TypeIDs'),
  categoryName: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .describe('Changelog category name; null clears the category'),
  productName: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .describe('Product name; null clears the product'),
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
  visibility: z
    .enum(['public', 'targeted'])
    .optional()
    .describe('"public" shows to everyone; "targeted" restricts to allowed segments/principals'),
  allowedSegmentIds: z
    .array(z.string())
    .max(200)
    .optional()
    .describe('Segment TypeIDs allowed to see this category when visibility is "targeted"'),
  allowedPrincipalIds: z
    .array(z.string())
    .max(200)
    .optional()
    .describe('Principal TypeIDs allowed to see this category when visibility is "targeted"'),
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
  categoryName?: string
  productName?: string
}

type UpdateChangelogArgs = {
  changelogId: string
  title?: string
  content?: string
  publish?: boolean
  publishedAt?: string
  displayDate?: string | null
  linkedPostIds?: string[]
  categoryName?: string | null
  productName?: string | null
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
  visibility?: 'public' | 'targeted'
  allowedSegmentIds?: string[]
  allowedPrincipalIds?: string[]
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
        const denied = requireScope(auth, 'read:article')
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
            const denied = requireScope(auth, 'read:article')
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
            const denied = requireScope(auth, 'read:article')
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
            categoryName: args.categoryName,
            productName: args.productName,
            publishState,
          },
          { principalId: auth.principalId, name: auth.name }
        )

        return jsonResult({
          id: result.id,
          title: result.title,
          status: result.status,
          category: result.category,
          product: result.product,
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
- Backdate display: update_changelog({ changelogId: "changelog_01abc...", displayDate: "2025-03-15T12:00:00Z" })
- Clear display override: update_changelog({ changelogId: "changelog_01abc...", displayDate: null })
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
          categoryName: args.categoryName,
          productName: args.productName,
          linkedPostIds: args.linkedPostIds as PostId[] | undefined,
          publishState,
          ...(args.displayDate !== undefined && {
            displayDate: args.displayDate === null ? null : new Date(args.displayDate),
          }),
        })

        return jsonResult({
          id: result.id,
          title: result.title,
          status: result.status,
          category: result.category,
          product: result.product,
          publishedAt: result.publishedAt,
          displayDate: result.displayDate,
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
              visibility: args.visibility,
              allowedSegmentIds: args.allowedSegmentIds,
              allowedPrincipalIds: args.allowedPrincipalIds,
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

  // Changelog audience/visibility configuration
  registerChangelogVisibilityTools(server, auth)

  // Audience segments
  registerSegmentTools(server, auth)

  // Feedback-plane configuration (boards, tags, post statuses, roadmaps)
  registerFeedbackConfigTools(server, auth)

  // Teams (workspace structure + membership)
  registerTeamTools(server, auth)

  // RBAC roles, permissions & assignments
  registerRoleTools(server, auth)

  // Support configuration read access (inboxes, routing, SLA, business hours)
  registerSupportConfigReadTools(server, auth)

  // Workspace settings (feature flags + help-center config)
  registerSettingsTools(server, auth)

  // Admin read access (users, API keys, audit log) + webhook management
  registerAdminTools(server, auth)

  // Content moderation (approve/reject pending posts + comments)
  registerModerationTools(server, auth)

  // Support config WRITE tools (inboxes, SLA policies, business hours)
  registerSupportConfigWriteTools(server, auth)

  // Portal tab visibility configuration (org defaults + per-segment overrides)
  registerPortalTabTools(server, auth)

  // Widget applications + per-environment profiles
  registerWidgetProfileTools(server, auth)

  // Custom user-attribute definitions
  registerUserAttributeTools(server, auth)

  // Ticketing — Phase 2 lifecycle tools
  registerTicketTools(server, auth)
  // Ticketing status catalogue + CRM — Phase 4
  registerTicketStatusTools(server, auth)
  registerContactTools(server, auth)
  registerOrganizationTools(server, auth)
}

// ============================================================================
// Audience segment tools — list / get / create / update / delete
// ============================================================================

function segmentResult(s: {
  id: string
  name: string
  slug: string
  description: string | null
  type: string
  color: string
  rules: unknown
  evaluationSchedule: unknown
  weightConfig: unknown
  createdAt: Date
  updatedAt: Date
  memberCount?: number
}): CallToolResult {
  return jsonResult({
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    type: s.type,
    color: s.color,
    rules: s.rules,
    evaluationSchedule: s.evaluationSchedule,
    weightConfig: s.weightConfig,
    memberCount: s.memberCount,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  })
}

function registerSegmentTools(server: McpServer, auth: McpAuthContext) {
  // list_segments
  server.tool(
    'list_segments',
    `List all audience segments with member counts.

Example: list_segments({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const rows = await listSegments()
        return jsonResult({ segments: rows.map((s) => ({ ...s })) })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // get_segment
  server.tool(
    'get_segment',
    `Get one audience segment by TypeID.

Example: get_segment({ segmentId: "segment_01..." })`,
    { segmentId: z.string().describe('Segment TypeID') },
    READ_ONLY,
    async (args: { segmentId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const segment = await getSegment(args.segmentId as SegmentId)
        if (!segment) return errorResult(new Error(`Segment ${args.segmentId} not found`))
        return segmentResult(segment)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_segment
  server.tool(
    'manage_segment',
    `Create, update, or delete an audience segment. Dynamic segments require at least one rule
condition; manual segments are populated by assigning members.

Examples:
- Create manual: manage_segment({ action: "create", name: "VIPs", type: "manual" })
- Create dynamic: manage_segment({ action: "create", name: "EU users", type: "dynamic", rules: { match: "all", conditions: [{ attribute: "country", operator: "eq", value: "DE" }] } })
- Update: manage_segment({ action: "update", segmentId: "segment_01...", name: "New name" })
- Delete: manage_segment({ action: "delete", segmentId: "segment_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete']).describe('Operation to perform'),
      segmentId: z.string().optional().describe('Required for update and delete'),
      name: z.string().optional().describe('Required for create'),
      description: z.string().nullable().optional(),
      type: z.enum(['manual', 'dynamic']).optional().describe('Required for create'),
      color: z.string().optional(),
      rules: z
        .object({
          match: z.enum(['all', 'any']),
          conditions: z.array(z.record(z.string(), z.unknown())),
        })
        .nullable()
        .optional()
        .describe('Membership rules for dynamic segments'),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete'
      segmentId?: string
      name?: string
      description?: string | null
      type?: 'manual' | 'dynamic'
      color?: string
      rules?: unknown
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        switch (args.action) {
          case 'create': {
            if (!args.name || !args.type) {
              return errorResult(new Error('name and type are required when action is "create"'))
            }
            const segment = await createSegment({
              name: args.name,
              type: args.type,
              description: args.description ?? undefined,
              color: args.color,
              rules: args.rules as never,
            })
            return segmentResult(segment)
          }
          case 'update': {
            if (!args.segmentId) {
              return errorResult(new Error('segmentId is required when action is "update"'))
            }
            const segment = await updateSegment(args.segmentId as SegmentId, {
              name: args.name,
              description: args.description,
              color: args.color,
              rules: args.rules as never,
            })
            return segmentResult(segment)
          }
          case 'delete': {
            if (!args.segmentId) {
              return errorResult(new Error('segmentId is required when action is "delete"'))
            }
            await deleteSegment(args.segmentId as SegmentId)
            return jsonResult({ deleted: true, id: args.segmentId })
          }
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Changelog visibility tools — org defaults + per-segment overrides
// ============================================================================

const changelogVisibilityConfigShape = {
  restrictCategories: z
    .boolean()
    .optional()
    .describe('When true, only allowedCategoryIds (plus uncategorized) are visible'),
  allowedCategoryIds: z
    .array(z.string())
    .max(500)
    .optional()
    .describe('Changelog category TypeIDs visible when restrictCategories is true'),
  restrictProducts: z
    .boolean()
    .optional()
    .describe('When true, only allowedProductIds (plus no-product) are visible'),
  allowedProductIds: z
    .array(z.string())
    .max(500)
    .optional()
    .describe('Changelog product TypeIDs visible when restrictProducts is true'),
}

// ============================================================================
// Moderation tools — approve/reject pending posts + comments (write:feedback)
// ============================================================================

function registerModerationTools(server: McpServer, auth: McpAuthContext) {
  const auditActor = () => ({
    userId: auth.userId ?? null,
    email: auth.email ?? null,
    role: auth.role,
  })

  server.tool(
    'list_pending_moderation',
    `List posts and comments awaiting moderation review.

Example: list_pending_moderation({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:feedback')
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/moderation/moderation.service')
        const [posts, comments] = await Promise.all([
          svc.listPendingPosts(),
          svc.listPendingComments(),
        ])
        return jsonResult({ posts, comments })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'moderate_post',
    `Approve or reject a pending post. Approve transitions pending → published; reject soft-deletes it.

Examples:
- Approve: moderate_post({ action: "approve", postId: "post_01..." })
- Reject: moderate_post({ action: "reject", postId: "post_01...", reason: "spam" })`,
    {
      action: z.enum(['approve', 'reject']),
      postId: z.string(),
      reason: z.string().max(1000).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'approve' | 'reject'
      postId: string
      reason?: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/moderation/moderation.service')
        if (args.action === 'approve') await svc.approvePost(args.postId as PostId, auditActor())
        else await svc.rejectPost(args.postId as PostId, args.reason, auditActor())
        return jsonResult({ ok: true, postId: args.postId, action: args.action })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'moderate_comment',
    `Approve or reject a pending comment.

Examples:
- Approve: moderate_comment({ action: "approve", commentId: "comment_01..." })
- Reject: moderate_comment({ action: "reject", commentId: "comment_01...", reason: "off-topic" })`,
    {
      action: z.enum(['approve', 'reject']),
      commentId: z.string(),
      reason: z.string().max(1000).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'approve' | 'reject'
      commentId: string
      reason?: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/moderation/moderation.service')
        if (args.action === 'approve')
          await svc.approveComment(args.commentId as CommentId, auditActor())
        else await svc.rejectComment(args.commentId as CommentId, args.reason, auditActor())
        return jsonResult({ ok: true, commentId: args.commentId, action: args.action })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Support config WRITE tools — inboxes, SLA policies, business hours (write:config)
// ============================================================================

function registerSupportConfigWriteTools(server: McpServer, auth: McpAuthContext) {
  const actor = () => ({ principalId: auth.principalId, userId: auth.userId ?? null })

  server.tool(
    'manage_inbox',
    `Create, update, archive, or unarchive a support inbox.

Examples:
- Create: manage_inbox({ action: "create", slug: "billing", name: "Billing" })
- Update: manage_inbox({ action: "update", inboxId: "inbox_01...", name: "Billing & Payments" })
- Archive: manage_inbox({ action: "archive", inboxId: "inbox_01..." })`,
    {
      action: z.enum(['create', 'update', 'archive', 'unarchive']),
      inboxId: z.string().optional(),
      slug: z.string().optional(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      primaryTeamId: z.string().nullable().optional(),
      defaultPriority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      color: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: string
      inboxId?: string
      [k: string]: unknown
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/inboxes')
        if (args.action === 'create') {
          if (!args.slug || !args.name)
            return errorResult(new Error('slug and name required for create'))
          return jsonResult(await svc.createInbox(args as never, actor()))
        }
        if (!args.inboxId) return errorResult(new Error('inboxId is required'))
        if (args.action === 'archive')
          return jsonResult(await svc.archiveInbox(args.inboxId as InboxId, actor()))
        if (args.action === 'unarchive')
          return jsonResult(await svc.unarchiveInbox(args.inboxId as InboxId, actor()))
        return jsonResult(await svc.updateInbox(args.inboxId as InboxId, args as never, actor()))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_sla_policy',
    `Create, update, or archive an SLA policy. Pass appliesToPriorities / targets as needed.

Examples:
- Create: manage_sla_policy({ action: "create", name: "Standard", scope: "workspace" })
- Archive: manage_sla_policy({ action: "archive", policyId: "sla_pol_01..." })`,
    {
      action: z.enum(['create', 'update', 'archive']),
      policyId: z.string().optional(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      scope: z.enum(['workspace', 'team', 'inbox']).optional(),
      enabled: z.boolean().optional(),
      priority: z.number().int().optional(),
      appliesToPriorities: z.array(z.string()).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: string
      policyId?: string
      [k: string]: unknown
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/sla/sla.policies.service')
        if (args.action === 'create') {
          if (!args.name || !args.scope)
            return errorResult(new Error('name and scope required for create'))
          return jsonResult(await svc.createSlaPolicy(args as never))
        }
        if (!args.policyId) return errorResult(new Error('policyId is required'))
        if (args.action === 'archive')
          return jsonResult(await svc.archiveSlaPolicy(args.policyId as SlaPolicyId))
        return jsonResult(await svc.updateSlaPolicy(args.policyId as SlaPolicyId, args as never))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_business_hours',
    `Create, update, or archive a business-hours calendar. "schedule" is a per-weekday object passed through
to the service (read the admin UI for its shape).

Examples:
- Create: manage_business_hours({ action: "create", name: "Weekdays", timezone: "America/New_York", schedule: { ... } })
- Archive: manage_business_hours({ action: "archive", businessHoursId: "bizhrs_01..." })`,
    {
      action: z.enum(['create', 'update', 'archive']),
      businessHoursId: z.string().optional(),
      name: z.string().optional(),
      timezone: z.string().optional(),
      schedule: z.record(z.string(), z.unknown()).optional(),
      holidays: z.array(z.record(z.string(), z.unknown())).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: string
      businessHoursId?: string
      [k: string]: unknown
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/sla/business-hours.service')
        if (args.action === 'create') {
          if (!args.name || !args.schedule)
            return errorResult(new Error('name and schedule required for create'))
          return jsonResult(await svc.createBusinessHours(args as never))
        }
        if (!args.businessHoursId) return errorResult(new Error('businessHoursId is required'))
        if (args.action === 'archive')
          return jsonResult(await svc.archiveBusinessHours(args.businessHoursId as BusinessHoursId))
        return jsonResult(
          await svc.updateBusinessHours(args.businessHoursId as BusinessHoursId, args as never)
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_routing_rule',
    `Create, update, delete, or reorder ticket routing rules.
Rules contain a condition set and one or more actions; use list_routing_rules to inspect current
rules and action payloads.

Examples:
- Create: manage_routing_rule({ action: "create", name: "VIP urgent", conditions: { match: "all", conditions: [{ field: "priority", op: "eq", value: "urgent" }] }, actions: [{ type: "assignToTeam", value: "team_01..." }] })
- Update: manage_routing_rule({ action: "update", ruleId: "route_rule_01...", enabled: false })
- Reorder: manage_routing_rule({ action: "reorder", orderedIds: ["route_rule_01...", "route_rule_02..."] })
- Delete: manage_routing_rule({ action: "delete", ruleId: "route_rule_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete', 'reorder']),
      ruleId: z.string().optional(),
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      priority: z.number().int().min(0).max(1_000_000).optional(),
      enabled: z.boolean().optional(),
      conditions: z
        .object({
          match: z.enum(['all', 'any']).optional(),
          conditions: z
            .array(
              z.object({
                field: z.enum([
                  'subject',
                  'descriptionText',
                  'channel',
                  'priority',
                  'organizationDomain',
                  'requesterEmail',
                  'inboxChannelKind',
                ]),
                op: z.enum(['eq', 'contains', 'matches', 'in']),
                value: z.union([z.string(), z.array(z.string())]),
              })
            )
            .min(1),
        })
        .optional(),
      actions: z
        .array(
          z.object({
            type: z.enum([
              'assignToInbox',
              'assignToTeam',
              'assignToPrincipal',
              'setPriority',
              'setVisibility',
              'addParticipant',
            ]),
            value: z.string().min(1),
          })
        )
        .min(1)
        .optional(),
      inboxIdScope: z
        .string()
        .nullable()
        .optional()
        .describe('Optional inbox TypeID scope; null means workspace-wide'),
      orderedIds: z.array(z.string().min(1)).min(1).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete' | 'reorder'
      ruleId?: string
      name?: string
      description?: string | null
      priority?: number
      enabled?: boolean
      conditions?: unknown
      actions?: unknown
      inboxIdScope?: string | null
      orderedIds?: string[]
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/inboxes')
        switch (args.action) {
          case 'create': {
            if (!args.name || !args.conditions || !args.actions) {
              return errorResult(
                new Error('name, conditions, and actions are required for action "create"')
              )
            }
            const created = await svc.createRoutingRule({
              name: args.name,
              description: args.description,
              priority: args.priority,
              enabled: args.enabled,
              conditions: args.conditions as never,
              actions: args.actions as never,
              inboxIdScope: args.inboxIdScope as InboxId | null | undefined,
            })
            return jsonResult(created)
          }
          case 'update': {
            if (!args.ruleId) {
              return errorResult(new Error('ruleId is required for action "update"'))
            }
            const updated = await svc.updateRoutingRule(args.ruleId as RoutingRuleId, {
              name: args.name,
              description: args.description,
              priority: args.priority,
              enabled: args.enabled,
              conditions: args.conditions as never,
              actions: args.actions as never,
              inboxIdScope: args.inboxIdScope as InboxId | null | undefined,
            })
            return jsonResult(updated)
          }
          case 'delete': {
            if (!args.ruleId) {
              return errorResult(new Error('ruleId is required for action "delete"'))
            }
            await svc.deleteRoutingRule(args.ruleId as RoutingRuleId)
            return jsonResult({ deleted: true, id: args.ruleId })
          }
          case 'reorder': {
            if (!args.orderedIds?.length) {
              return errorResult(new Error('orderedIds is required for action "reorder"'))
            }
            await svc.reorderRoutingRules(args.orderedIds as RoutingRuleId[])
            return jsonResult({ ok: true, orderedIds: args.orderedIds })
          }
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Admin tools — users, API keys, audit log (read:admin) + webhooks (manage:admin)
// ============================================================================

function registerAdminTools(server: McpServer, auth: McpAuthContext) {
  server.tool(
    'list_users',
    `List portal users (optionally filtered by a search string).

Example: list_users({ search: "acme.com" })`,
    { search: z.string().optional() },
    READ_ONLY,
    async (args: { search?: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      try {
        const { listPortalUsers } = await import('@/lib/server/domains/users/user.service')
        return jsonResult(await listPortalUsers({ search: args.search }))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'list_api_keys',
    `List API keys (metadata only — secrets are never returned).

Example: list_api_keys({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      try {
        const { listApiKeys } = await import('@/lib/server/domains/api-keys/api-key.service')
        return jsonResult({ apiKeys: await listApiKeys() })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'list_audit_events',
    `Read the workspace audit log (most recent first). Supports filtering by action prefix, actor, target.

Examples:
- Recent: list_audit_events({ limit: 50 })
- By action prefix: list_audit_events({ actionPrefix: "ticket." })`,
    {
      limit: z.number().int().min(1).max(200).optional(),
      action: z.string().optional(),
      actionPrefix: z.string().optional(),
      principalId: z.string().optional(),
      cursor: z.string().optional(),
    },
    READ_ONLY,
    async (args: {
      limit?: number
      action?: string
      actionPrefix?: string
      principalId?: string
      cursor?: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      try {
        const { listAuditEvents } = await import('@/lib/server/domains/audit')
        return jsonResult(
          await listAuditEvents({
            limit: args.limit,
            action: args.action,
            actionPrefix: args.actionPrefix,
            principalId: args.principalId as PrincipalId | undefined,
            cursor: args.cursor,
          })
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'list_webhooks',
    `List outbound webhooks (their subscribed events and target URLs; secrets are never returned).

Example: list_webhooks({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      try {
        const { listWebhooks } = await import('@/lib/server/domains/webhooks/webhook.service')
        return jsonResult({ webhooks: await listWebhooks() })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_webhook',
    `Create, update, delete, or rotate the secret of an outbound webhook. On create/rotate the signing
secret is returned ONCE — store it securely. Event ids must be valid webhook event types.

Examples:
- Create: manage_webhook({ action: "create", url: "https://example.com/hook", events: ["ticket.created","ticket.thread_added"] })
- Update: manage_webhook({ action: "update", webhookId: "webhook_01...", status: "disabled" })
- Rotate secret: manage_webhook({ action: "rotate", webhookId: "webhook_01..." })
- Delete: manage_webhook({ action: "delete", webhookId: "webhook_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete', 'rotate']),
      webhookId: z.string().optional(),
      url: z.string().optional(),
      events: z.array(z.string()).optional(),
      boardIds: z.array(z.string()).nullable().optional(),
      inboxIds: z.array(z.string()).nullable().optional(),
      status: z.enum(['active', 'disabled']).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete' | 'rotate'
      webhookId?: string
      url?: string
      events?: string[]
      boardIds?: string[] | null
      inboxIds?: string[] | null
      status?: 'active' | 'disabled'
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'manage:admin') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/webhooks/webhook.service')
        if (args.action === 'create') {
          if (!args.url || !args.events?.length) {
            return errorResult(new Error('url and events are required when action is "create"'))
          }
          return jsonResult(
            await svc.createWebhook(
              {
                url: args.url,
                events: args.events,
                boardIds: args.boardIds ?? undefined,
                inboxIds: args.inboxIds ?? undefined,
              },
              auth.principalId
            )
          )
        }
        if (!args.webhookId) return errorResult(new Error('webhookId is required'))
        if (args.action === 'delete') {
          await svc.deleteWebhook(args.webhookId as WebhookId)
          return jsonResult({ deleted: true, id: args.webhookId })
        }
        if (args.action === 'rotate') {
          return jsonResult(await svc.rotateWebhookSecret(args.webhookId as WebhookId))
        }
        return jsonResult(
          await svc.updateWebhook(args.webhookId as WebhookId, {
            url: args.url,
            events: args.events,
            boardIds: args.boardIds,
            inboxIds: args.inboxIds,
            status: args.status,
          })
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Settings tools — feature flags + help-center config (read/write:config)
// ============================================================================

function registerSettingsTools(server: McpServer, auth: McpAuthContext) {
  server.tool(
    'get_settings',
    `Read workspace settings: feature flags and help-center configuration.

Example: get_settings({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/settings/settings.service')
        const [featureFlags, helpCenter] = await Promise.all([
          svc.getFeatureFlags(),
          svc.getHelpCenterConfig(),
        ])
        return jsonResult({ featureFlags, helpCenter })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'update_settings',
    `Update workspace settings. Provide featureFlags (partial) and/or helpCenter config.

Examples:
- Toggle a feature: update_settings({ featureFlags: { tickets: true } })
- Help center: update_settings({ helpCenter: { homepageTitle: "Help" } })`,
    {
      featureFlags: z
        .object({
          helpCenter: z.boolean(),
          aiFeedbackExtraction: z.boolean(),
          tickets: z.boolean(),
          supportInbox: z.boolean(),
          linkPreviews: z.boolean(),
        })
        .partial()
        .optional(),
      helpCenter: z
        .object({
          enabled: z.boolean(),
          homepageTitle: z.string().max(200),
          homepageDescription: z.string().max(500),
        })
        .partial()
        .optional(),
    },
    WRITE,
    async (args: {
      featureFlags?: Record<string, boolean>
      helpCenter?: Record<string, unknown>
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/settings/settings.service')
        const result: Record<string, unknown> = {}
        if (args.featureFlags) result.featureFlags = await svc.updateFeatureFlags(args.featureFlags)
        if (args.helpCenter)
          result.helpCenter = await svc.updateHelpCenterConfig(args.helpCenter as never)
        if (!args.featureFlags && !args.helpCenter) {
          return errorResult(new Error('Provide featureFlags and/or helpCenter to update'))
        }
        return jsonResult(result)
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Support config read tools — inboxes, routing rules, SLA policies, business
// hours (read:config). Writes for these stay on the REST API.
// ============================================================================

function registerSupportConfigReadTools(server: McpServer, auth: McpAuthContext) {
  server.tool(
    'list_inboxes',
    `List support inboxes (set includeArchived to include archived).

Example: list_inboxes({})`,
    { includeArchived: z.boolean().optional() },
    READ_ONLY,
    async (args: { includeArchived?: boolean }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const { listInboxes } = await import('@/lib/server/domains/inboxes')
        return jsonResult({ inboxes: await listInboxes({ includeArchived: args.includeArchived }) })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'get_inbox',
    `Get one support inbox by TypeID.

Example: get_inbox({ inboxId: "inbox_01..." })`,
    { inboxId: z.string() },
    READ_ONLY,
    async (args: { inboxId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const { getInbox } = await import('@/lib/server/domains/inboxes')
        const inbox = await getInbox(args.inboxId as InboxId)
        if (!inbox) return errorResult(new Error(`Inbox ${args.inboxId} not found`))
        return jsonResult(inbox)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'list_routing_rules',
    `List ticket routing rules (set enabledOnly to filter to active rules).

Example: list_routing_rules({})`,
    { enabledOnly: z.boolean().optional() },
    READ_ONLY,
    async (args: { enabledOnly?: boolean }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const { listRoutingRules } = await import('@/lib/server/domains/inboxes')
        return jsonResult({ rules: await listRoutingRules({ enabledOnly: args.enabledOnly }) })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'list_sla_policies',
    `List SLA policies (set includeArchived to include archived).

Example: list_sla_policies({})`,
    { includeArchived: z.boolean().optional() },
    READ_ONLY,
    async (args: { includeArchived?: boolean }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const { listSlaPolicies } = await import('@/lib/server/domains/sla/sla.policies.service')
        return jsonResult({
          policies: await listSlaPolicies({ includeArchived: args.includeArchived }),
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'get_sla_policy',
    `Get an SLA policy with its response/resolution targets and escalation rules.

Example: get_sla_policy({ policyId: "sla_pol_01..." })`,
    { policyId: z.string() },
    READ_ONLY,
    async (args: { policyId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/sla/sla.policies.service')
        const policy = await svc.getSlaPolicy(args.policyId as SlaPolicyId)
        if (!policy) return errorResult(new Error(`SLA policy ${args.policyId} not found`))
        const [targets, escalationRules] = await Promise.all([
          svc.listTargetsForPolicy(args.policyId as SlaPolicyId),
          svc.listEscalationRulesForPolicy(args.policyId as SlaPolicyId),
        ])
        return jsonResult({ ...policy, targets, escalationRules })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'list_business_hours',
    `List business-hours calendars (set includeArchived to include archived).

Example: list_business_hours({})`,
    { includeArchived: z.boolean().optional() },
    READ_ONLY,
    async (args: { includeArchived?: boolean }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const { listBusinessHours } =
          await import('@/lib/server/domains/sla/business-hours.service')
        return jsonResult({
          businessHours: await listBusinessHours({ includeArchived: args.includeArchived }),
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// RBAC role tools — roles, permission catalogue, assignments (admin: read/manage:admin)
// ============================================================================

function registerRoleTools(server: McpServer, auth: McpAuthContext) {
  server.tool(
    'list_permissions',
    `List the RBAC permission catalogue (all permission keys grouped by category).

Example: list_permissions({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      return jsonResult({
        permissions: ALL_PERMISSIONS,
        categories: Object.fromEntries(
          Object.entries(PERMISSION_CATEGORIES).map(([c, k]) => [c, [...k]])
        ),
      })
    }
  )

  server.tool(
    'list_roles',
    `List all roles with permission counts.

Example: list_roles({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      try {
        return jsonResult({ roles: await listRoles() })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'get_role',
    `Get one role with its full permission list.

Example: get_role({ roleId: "role_01..." })`,
    { roleId: z.string() },
    READ_ONLY,
    async (args: { roleId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      try {
        return jsonResult(await getRoleWithPermissions(args.roleId as RoleId))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_role',
    `Create, update, delete a custom role, or replace its permission set. System roles cannot be deleted.

Examples:
- Create: manage_role({ action: "create", key: "billing_agent", name: "Billing Agent", permissionKeys: ["ticket.view_team","ticket.reply_public"] })
- Update: manage_role({ action: "update", roleId: "role_01...", name: "Billing" })
- Set permissions: manage_role({ action: "set_permissions", roleId: "role_01...", permissionKeys: ["ticket.view_all"] })
- Delete: manage_role({ action: "delete", roleId: "role_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete', 'set_permissions']),
      roleId: z.string().optional(),
      key: z.string().optional(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      permissionKeys: z.array(z.string()).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete' | 'set_permissions'
      roleId?: string
      key?: string
      name?: string
      description?: string | null
      permissionKeys?: string[]
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'manage:admin') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        if (args.action === 'create') {
          if (!args.key || !args.name) {
            return errorResult(new Error('key and name are required when action is "create"'))
          }
          const roleId = await createRole({
            key: args.key,
            name: args.name,
            description: args.description,
            permissionKeys: (args.permissionKeys ?? []) as PermissionKey[],
            actorPrincipalId: auth.principalId,
          })
          return jsonResult(await getRoleWithPermissions(roleId))
        }
        if (!args.roleId) return errorResult(new Error('roleId is required'))
        if (args.action === 'delete') {
          await deleteRole({ id: args.roleId as RoleId, actorPrincipalId: auth.principalId })
          return jsonResult({ deleted: true, id: args.roleId })
        }
        if (args.action === 'set_permissions') {
          await setRolePermissions({
            roleId: args.roleId as RoleId,
            permissionKeys: (args.permissionKeys ?? []) as PermissionKey[],
            actorPrincipalId: auth.principalId,
          })
          return jsonResult(await getRoleWithPermissions(args.roleId as RoleId))
        }
        if (!args.name) return errorResult(new Error('name is required when action is "update"'))
        await updateRole({
          id: args.roleId as RoleId,
          name: args.name,
          description: args.description,
          actorPrincipalId: auth.principalId,
        })
        return jsonResult(await getRoleWithPermissions(args.roleId as RoleId))
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'list_principal_roles',
    `List a principal's role assignments.

Example: list_principal_roles({ principalId: "principal_01..." })`,
    { principalId: z.string() },
    READ_ONLY,
    async (args: { principalId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:admin')
      if (denied) return denied
      try {
        return jsonResult({
          assignments: await listAssignmentsForPrincipal(args.principalId as PrincipalId),
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_role_assignment',
    `Assign a role to a principal (optionally team-scoped) or revoke an assignment by id.

Examples:
- Assign: manage_role_assignment({ action: "assign", principalId: "principal_01...", roleId: "role_01...", teamId: "team_01..." })
- Revoke: manage_role_assignment({ action: "revoke", assignmentId: "role_asgn_01..." })`,
    {
      action: z.enum(['assign', 'revoke']),
      principalId: z.string().optional(),
      roleId: z.string().optional(),
      teamId: z.string().nullable().optional(),
      assignmentId: z.string().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'assign' | 'revoke'
      principalId?: string
      roleId?: string
      teamId?: string | null
      assignmentId?: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'manage:admin') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        if (args.action === 'revoke') {
          if (!args.assignmentId)
            return errorResult(new Error('assignmentId is required to revoke'))
          await revokeRoleAssignment({
            assignmentId: args.assignmentId as RoleAssignmentId,
            actorPrincipalId: auth.principalId,
          })
          return jsonResult({ revoked: true, id: args.assignmentId })
        }
        if (!args.principalId || !args.roleId) {
          return errorResult(new Error('principalId and roleId are required to assign'))
        }
        const assignmentId = await assignRole({
          principalId: args.principalId as PrincipalId,
          roleId: args.roleId as RoleId,
          teamId: (args.teamId as TeamId | null | undefined) ?? null,
          actorPrincipalId: auth.principalId,
        })
        return jsonResult({ id: assignmentId, principalId: args.principalId, roleId: args.roleId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Team tools — workspace structure + membership (config-plane: read/write:config)
// ============================================================================

function registerTeamTools(server: McpServer, auth: McpAuthContext) {
  const teamActor = () => ({ principalId: auth.principalId, userId: auth.userId ?? null })

  server.tool(
    'list_teams',
    `List teams (set includeArchived to also return archived teams).

Example: list_teams({})`,
    { includeArchived: z.boolean().optional() },
    READ_ONLY,
    async (args: { includeArchived?: boolean }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        return jsonResult({ teams: await listTeams({ includeArchived: args.includeArchived }) })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'get_team',
    `Get one team by TypeID, including its members.

Example: get_team({ teamId: "team_01..." })`,
    { teamId: z.string() },
    READ_ONLY,
    async (args: { teamId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const team = await getTeam(args.teamId as TeamId)
        if (!team) return errorResult(new Error(`Team ${args.teamId} not found`))
        const members = await listTeamMembers(args.teamId as TeamId)
        return jsonResult({ ...team, members })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_team',
    `Create, update, archive, or unarchive a team.

Examples:
- Create: manage_team({ action: "create", slug: "billing", name: "Billing" })
- Update: manage_team({ action: "update", teamId: "team_01...", name: "Billing & Payments" })
- Archive: manage_team({ action: "archive", teamId: "team_01..." })
- Unarchive: manage_team({ action: "unarchive", teamId: "team_01..." })`,
    {
      action: z.enum(['create', 'update', 'archive', 'unarchive']),
      teamId: z.string().optional(),
      slug: z.string().optional(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      shortLabel: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'archive' | 'unarchive'
      teamId?: string
      slug?: string
      name?: string
      description?: string | null
      shortLabel?: string | null
      color?: string | null
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        if (args.action === 'create') {
          if (!args.slug || !args.name) {
            return errorResult(new Error('slug and name are required when action is "create"'))
          }
          return jsonResult(
            await createTeam(
              {
                slug: args.slug,
                name: args.name,
                description: args.description,
                shortLabel: args.shortLabel,
                color: args.color,
              },
              teamActor()
            )
          )
        }
        if (!args.teamId) return errorResult(new Error('teamId is required'))
        if (args.action === 'archive') {
          await archiveTeam(args.teamId as TeamId, teamActor())
          return jsonResult({ archived: true, id: args.teamId })
        }
        if (args.action === 'unarchive') {
          await unarchiveTeam(args.teamId as TeamId, teamActor())
          return jsonResult(await getTeam(args.teamId as TeamId))
        }
        return jsonResult(
          await updateTeam(
            args.teamId as TeamId,
            {
              name: args.name,
              description: args.description,
              shortLabel: args.shortLabel,
              color: args.color,
            },
            teamActor()
          )
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  server.tool(
    'manage_team_member',
    `Add (or update the role of) or remove a team member.

Examples:
- Add: manage_team_member({ action: "add", teamId: "team_01...", principalId: "principal_01...", role: "member" })
- Remove: manage_team_member({ action: "remove", teamId: "team_01...", principalId: "principal_01..." })`,
    {
      action: z.enum(['add', 'remove']),
      teamId: z.string(),
      principalId: z.string(),
      role: z.enum(['lead', 'member']).optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'add' | 'remove'
      teamId: string
      principalId: string
      role?: 'lead' | 'member'
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        if (args.action === 'remove') {
          await removeTeamMember(args.teamId as TeamId, args.principalId as PrincipalId)
          return jsonResult({ removed: true, teamId: args.teamId, principalId: args.principalId })
        }
        return jsonResult(
          await addTeamMember(
            args.teamId as TeamId,
            args.principalId as PrincipalId,
            args.role ?? 'member'
          )
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Feedback-plane configuration tools — boards, tags, post statuses, roadmaps
// (feedback-plane: gated by write:feedback + team role, mirroring create_post)
// ============================================================================

function registerFeedbackConfigTools(server: McpServer, auth: McpAuthContext) {
  // manage_board
  server.tool(
    'manage_board',
    `Create, update, or delete a feedback board.

Examples:
- Create: manage_board({ action: "create", name: "Feature Requests" })
- Update: manage_board({ action: "update", boardId: "board_01...", name: "Ideas", description: "..." })
- Delete: manage_board({ action: "delete", boardId: "board_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete']),
      boardId: z.string().optional().describe('Required for update and delete'),
      name: z.string().max(200).optional().describe('Required for create'),
      slug: z.string().max(200).optional(),
      description: z.string().nullable().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete'
      boardId?: string
      name?: string
      slug?: string
      description?: string | null
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        if (args.action === 'create') {
          if (!args.name) return errorResult(new Error('name is required when action is "create"'))
          return jsonResult(
            await createBoard({ name: args.name, slug: args.slug, description: args.description })
          )
        }
        if (!args.boardId) return errorResult(new Error('boardId is required'))
        if (args.action === 'delete') {
          await deleteBoard(args.boardId as BoardId)
          return jsonResult({ deleted: true, id: args.boardId })
        }
        return jsonResult(
          await updateBoard(args.boardId as BoardId, {
            name: args.name,
            slug: args.slug,
            description: args.description,
          })
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_tag
  server.tool(
    'manage_tag',
    `Create, update, or delete a post tag.

Examples:
- Create: manage_tag({ action: "create", name: "bug", color: "#ef4444" })
- Update: manage_tag({ action: "update", tagId: "tag_01...", name: "defect" })
- Delete: manage_tag({ action: "delete", tagId: "tag_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete']),
      tagId: z.string().optional().describe('Required for update and delete'),
      name: z.string().max(50).optional().describe('Required for create'),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      description: z.string().max(200).nullable().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete'
      tagId?: string
      name?: string
      color?: string
      description?: string | null
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        if (args.action === 'create') {
          if (!args.name) return errorResult(new Error('name is required when action is "create"'))
          return jsonResult(
            await createTag({
              name: args.name,
              color: args.color,
              description: args.description ?? undefined,
            })
          )
        }
        if (!args.tagId) return errorResult(new Error('tagId is required'))
        if (args.action === 'delete') {
          await deleteTag(args.tagId as TagId)
          return jsonResult({ deleted: true, id: args.tagId })
        }
        return jsonResult(
          await updateTag(args.tagId as TagId, {
            name: args.name,
            color: args.color,
            description: args.description,
          })
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_status (post statuses)
  server.tool(
    'manage_status',
    `Create, update, delete, reorder, or set-default a post status. Categories: active, complete, closed.

Examples:
- Create: manage_status({ action: "create", name: "Planned", slug: "planned", color: "#3b82f6", category: "active" })
- Update: manage_status({ action: "update", statusId: "status_01...", name: "In Progress" })
- Set default: manage_status({ action: "set_default", statusId: "status_01..." })
- Reorder: manage_status({ action: "reorder", statusIds: ["status_01...","status_02..."] })
- Delete: manage_status({ action: "delete", statusId: "status_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete', 'reorder', 'set_default']),
      statusId: z.string().optional(),
      statusIds: z.array(z.string()).optional().describe('Ordered ids for action="reorder"'),
      name: z.string().max(100).optional(),
      slug: z.string().max(100).optional(),
      color: z.string().optional(),
      category: z.enum(['active', 'complete', 'closed']).optional(),
      position: z.number().int().optional(),
      showOnRoadmap: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete' | 'reorder' | 'set_default'
      statusId?: string
      statusIds?: string[]
      name?: string
      slug?: string
      color?: string
      category?: 'active' | 'complete' | 'closed'
      position?: number
      showOnRoadmap?: boolean
      isDefault?: boolean
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        switch (args.action) {
          case 'create':
            if (!args.name || !args.slug || !args.color || !args.category) {
              return errorResult(
                new Error('name, slug, color and category are required for create')
              )
            }
            return jsonResult(
              await createStatus({
                name: args.name,
                slug: args.slug,
                color: args.color,
                category: args.category,
                position: args.position,
                showOnRoadmap: args.showOnRoadmap,
                isDefault: args.isDefault,
              })
            )
          case 'reorder':
            if (!args.statusIds?.length) return errorResult(new Error('statusIds is required'))
            await reorderStatuses(args.statusIds as StatusId[])
            return jsonResult({ reordered: true, count: args.statusIds.length })
          case 'set_default':
            if (!args.statusId) return errorResult(new Error('statusId is required'))
            return jsonResult(await setDefaultStatus(args.statusId as StatusId))
          case 'delete':
            if (!args.statusId) return errorResult(new Error('statusId is required'))
            await deleteStatus(args.statusId as StatusId)
            return jsonResult({ deleted: true, id: args.statusId })
          case 'update':
            if (!args.statusId) return errorResult(new Error('statusId is required'))
            return jsonResult(
              await updateStatus(args.statusId as StatusId, {
                name: args.name,
                color: args.color,
                showOnRoadmap: args.showOnRoadmap,
                isDefault: args.isDefault,
              })
            )
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_roadmap (roadmap CRUD + reorder; complements manage_roadmap_post)
  server.tool(
    'manage_roadmap',
    `Create, update, delete, or reorder roadmaps. (Use manage_roadmap_post to add/remove posts.)

Examples:
- Create: manage_roadmap({ action: "create", name: "2026 Roadmap", slug: "2026" })
- Update: manage_roadmap({ action: "update", roadmapId: "roadmap_01...", isPublic: true })
- Reorder: manage_roadmap({ action: "reorder", roadmapIds: ["roadmap_01...","roadmap_02..."] })
- Delete: manage_roadmap({ action: "delete", roadmapId: "roadmap_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete', 'reorder']),
      roadmapId: z.string().optional(),
      roadmapIds: z.array(z.string()).optional().describe('Ordered ids for action="reorder"'),
      name: z.string().max(200).optional(),
      slug: z.string().max(200).optional(),
      description: z.string().optional(),
      isPublic: z.boolean().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete' | 'reorder'
      roadmapId?: string
      roadmapIds?: string[]
      name?: string
      slug?: string
      description?: string
      isPublic?: boolean
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:feedback') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        switch (args.action) {
          case 'create':
            if (!args.name || !args.slug) {
              return errorResult(new Error('name and slug are required for create'))
            }
            return jsonResult(
              await createRoadmap({
                name: args.name,
                slug: args.slug,
                description: args.description,
                isPublic: args.isPublic,
              })
            )
          case 'reorder':
            if (!args.roadmapIds?.length) return errorResult(new Error('roadmapIds is required'))
            await reorderRoadmaps(args.roadmapIds as RoadmapId[])
            return jsonResult({ reordered: true, count: args.roadmapIds.length })
          case 'delete':
            if (!args.roadmapId) return errorResult(new Error('roadmapId is required'))
            await deleteRoadmap(args.roadmapId as RoadmapId)
            return jsonResult({ deleted: true, id: args.roadmapId })
          case 'update':
            if (!args.roadmapId) return errorResult(new Error('roadmapId is required'))
            return jsonResult(
              await updateRoadmap(args.roadmapId as RoadmapId, {
                name: args.name,
                description: args.description,
                isPublic: args.isPublic,
              })
            )
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

function registerUserAttributeTools(server: McpServer, auth: McpAuthContext) {
  // list_user_attributes
  server.tool(
    'list_user_attributes',
    `List custom user-attribute definitions (key, label, type, currency, external mapping key).

Example: list_user_attributes({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const rows = await listUserAttributes()
        return jsonResult({ attributes: rows.map((a) => ({ ...a })) })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_user_attribute
  server.tool(
    'manage_user_attribute',
    `Create, update, or delete a custom user-attribute definition. Currency attributes require a
currencyCode (ISO 4217). The key is normalised to lower_snake_case on create.

Examples:
- Create: manage_user_attribute({ action: "create", key: "plan_tier", label: "Plan Tier", type: "string" })
- Currency: manage_user_attribute({ action: "create", key: "mrr", label: "MRR", type: "currency", currencyCode: "USD" })
- Update: manage_user_attribute({ action: "update", attributeId: "user_attr_01...", label: "New Label" })
- Delete: manage_user_attribute({ action: "delete", attributeId: "user_attr_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete']).describe('Operation to perform'),
      attributeId: z.string().optional().describe('Required for update and delete'),
      key: z.string().max(100).optional().describe('Required for create'),
      label: z.string().max(200).optional().describe('Required for create'),
      description: z.string().max(1000).nullable().optional(),
      type: z
        .enum(['string', 'number', 'boolean', 'date', 'currency'])
        .optional()
        .describe('Required for create'),
      currencyCode: z
        .enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'BRL'])
        .nullable()
        .optional(),
      externalKey: z.string().max(200).nullable().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete'
      attributeId?: string
      key?: string
      label?: string
      description?: string | null
      type?: 'string' | 'number' | 'boolean' | 'date' | 'currency'
      currencyCode?: string | null
      externalKey?: string | null
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        switch (args.action) {
          case 'create': {
            if (!args.key || !args.label || !args.type) {
              return errorResult(
                new Error('key, label and type are required when action is "create"')
              )
            }
            const attribute = await createUserAttribute({
              key: args.key,
              label: args.label,
              description: args.description,
              type: args.type,
              currencyCode: args.currencyCode as never,
              externalKey: args.externalKey,
            })
            return jsonResult(attribute)
          }
          case 'update': {
            if (!args.attributeId) {
              return errorResult(new Error('attributeId is required when action is "update"'))
            }
            const attribute = await updateUserAttribute(args.attributeId as UserAttributeId, {
              label: args.label,
              description: args.description,
              type: args.type,
              currencyCode: args.currencyCode as never,
              externalKey: args.externalKey,
            })
            return jsonResult(attribute)
          }
          case 'delete': {
            if (!args.attributeId) {
              return errorResult(new Error('attributeId is required when action is "delete"'))
            }
            await deleteUserAttribute(args.attributeId as UserAttributeId)
            return jsonResult({ deleted: true, id: args.attributeId })
          }
        }
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

function registerChangelogVisibilityTools(server: McpServer, auth: McpAuthContext) {
  // get_changelog_visibility
  server.tool(
    'get_changelog_visibility',
    `Read changelog audience visibility configuration. Without a segmentId, returns the org-level
default and the list of per-segment overrides. With a segmentId, returns that segment's override.

Examples:
- Org defaults + all overrides: get_changelog_visibility({})
- One segment: get_changelog_visibility({ segmentId: "segment_01..." })`,
    { segmentId: z.string().optional().describe('Segment TypeID to read a single override') },
    READ_ONLY,
    async (args: { segmentId?: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:feedback')
      if (denied) return denied
      try {
        if (args.segmentId) {
          const config = await getSegmentChangelogVisibility(args.segmentId as SegmentId)
          return jsonResult({ segmentId: args.segmentId, config })
        }
        const [org, segments] = await Promise.all([
          getOrgChangelogVisibility(),
          getAllSegmentChangelogVisibilities(),
        ])
        return jsonResult({ org, segments })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // set_changelog_visibility
  server.tool(
    'set_changelog_visibility',
    `Set changelog audience visibility. Without a segmentId, replaces the org-level default. With a
segmentId, upserts that segment's override.

Examples:
- Restrict org to two categories: set_changelog_visibility({ restrictCategories: true, allowedCategoryIds: ["changelog_cat_01...","changelog_cat_02..."] })
- Per-segment override: set_changelog_visibility({ segmentId: "segment_01...", restrictProducts: true, allowedProductIds: ["changelog_prod_01..."] })`,
    { segmentId: z.string().optional(), ...changelogVisibilityConfigShape },
    WRITE,
    async (args: {
      segmentId?: string
      restrictCategories?: boolean
      allowedCategoryIds?: string[]
      restrictProducts?: boolean
      allowedProductIds?: string[]
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:changelog') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { segmentId, ...config } = args
        if (segmentId) {
          await setSegmentChangelogVisibility(segmentId as SegmentId, config)
          return jsonResult({
            segmentId,
            config: await getSegmentChangelogVisibility(segmentId as SegmentId),
          })
        }
        await setOrgChangelogVisibility(config)
        return jsonResult({ org: await getOrgChangelogVisibility() })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // delete_changelog_segment_visibility
  server.tool(
    'delete_changelog_segment_visibility',
    `Remove a per-segment changelog visibility override (the segment falls back to org defaults).

Example: delete_changelog_segment_visibility({ segmentId: "segment_01..." })`,
    { segmentId: z.string().describe('Segment TypeID whose override to remove') },
    DESTRUCTIVE,
    async (args: { segmentId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:changelog') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        await deleteSegmentChangelogVisibility(args.segmentId as SegmentId)
        return jsonResult({ deleted: true, segmentId: args.segmentId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Portal tab tools — org defaults + per-segment overrides
// ============================================================================

const portalTabConfigShape = {
  feedback: z.boolean().optional().describe('Show the Feedback tab'),
  roadmap: z.boolean().optional().describe('Show the Roadmap tab'),
  changelog: z.boolean().optional().describe('Show the Changelog tab'),
  myTickets: z.boolean().optional().describe('Show the My Tickets tab'),
  helpCenter: z.boolean().optional().describe('Show the Help Center tab'),
  support: z.boolean().optional().describe('Show the Support tab'),
}

function registerPortalTabTools(server: McpServer, auth: McpAuthContext) {
  // get_portal_tabs
  server.tool(
    'get_portal_tabs',
    `Read portal tab visibility configuration. Returns the organization-level defaults and the list
of per-segment overrides (each with segment name). Each tab is an optional boolean; an absent key
falls back to the org/segment default (visible).

Example: get_portal_tabs({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const [org, segments] = await Promise.all([
          getOrgPortalTabConfig(),
          getAllSegmentTabOverrides(),
        ])
        return jsonResult({ org, segments })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // set_portal_tabs
  server.tool(
    'set_portal_tabs',
    `Set portal tab visibility. Without a segmentId, replaces the organization-level defaults. With a
segmentId, upserts that segment's override. Only the tabs you provide are written; omitted tabs are
left unset (falling back to the default).

Examples:
- Org defaults (hide changelog): set_portal_tabs({ changelog: false })
- Per-segment override: set_portal_tabs({ segmentId: "segment_01...", roadmap: false, support: true })`,
    {
      segmentId: z.string().optional().describe('Segment TypeID to upsert an override'),
      ...portalTabConfigShape,
    },
    WRITE,
    async (args: {
      segmentId?: string
      feedback?: boolean
      roadmap?: boolean
      changelog?: boolean
      myTickets?: boolean
      helpCenter?: boolean
      support?: boolean
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { segmentId, ...config } = args
        if (segmentId) {
          await setSegmentTabOverrides(segmentId as SegmentId, config as PortalTabConfig)
          return jsonResult({
            segmentId,
            config: await getSegmentTabOverrides(segmentId as SegmentId),
          })
        }
        await setOrgPortalTabConfig(config as PortalTabConfig)
        return jsonResult({ org: await getOrgPortalTabConfig() })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // delete_portal_tab_segment
  server.tool(
    'delete_portal_tab_segment',
    `Remove a per-segment portal tab override (the segment falls back to org defaults).

Example: delete_portal_tab_segment({ segmentId: "segment_01..." })`,
    { segmentId: z.string().describe('Segment TypeID whose override to remove') },
    DESTRUCTIVE,
    async (args: { segmentId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        await deleteSegmentTabOverrides(args.segmentId as SegmentId)
        return jsonResult({ deleted: true, segmentId: args.segmentId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )
}

// ============================================================================
// Widget profile tools — applications + per-environment profiles
// ============================================================================

function registerWidgetProfileTools(server: McpServer, auth: McpAuthContext) {
  // list_widget_applications
  server.tool(
    'list_widget_applications',
    `List widget applications, each with its active per-environment profiles. A widget application is
a stable public integration key for an external app; each application can have one active profile
per environment.

Example: list_widget_applications({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:config')
      if (denied) return denied
      try {
        const rows = await listWidgetApplications()
        return jsonResult({ applications: rows })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_widget_application
  server.tool(
    'manage_widget_application',
    `Create or update a widget application. Omit id to create; supply id to update the matching active
application. The key is normalised (trimmed, lowercased, disallowed characters collapsed to hyphens).

Examples:
- Create: manage_widget_application({ key: "marketing-site", name: "Marketing Site" })
- Update: manage_widget_application({ id: "widget_app_01...", name: "Marketing Site", description: "Embedded on www" })`,
    {
      id: z.string().optional().describe('Widget application TypeID; omit to create'),
      key: z.string().min(1).max(120).describe('Stable public integration key'),
      name: z.string().min(1).max(200).describe('Display name'),
      description: z.string().max(1000).nullable().optional().describe('Optional description'),
    },
    WRITE,
    async (args: {
      id?: string
      key: string
      name: string
      description?: string | null
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const application = await upsertWidgetApplication({
          id: args.id,
          key: args.key,
          name: args.name,
          description: args.description,
        })
        if (!application) {
          return errorResult(new Error(`Widget application ${args.id} not found (or archived)`))
        }
        return jsonResult(application)
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_widget_environment_profile
  server.tool(
    'manage_widget_environment_profile',
    `Create or update a per-environment profile for a widget application. Omit id to create; supply id
to update the matching active profile. The environment is normalised; an absent displayName defaults
to the normalised environment.

Examples:
- Create: manage_widget_environment_profile({ applicationId: "widget_app_01...", environment: "production", allowedOrigins: ["https://www.example.com"] })
- Update: manage_widget_environment_profile({ id: "widget_profile_01...", applicationId: "widget_app_01...", environment: "production", enabled: false })`,
    {
      id: z.string().optional().describe('Widget environment profile TypeID; omit to create'),
      applicationId: z.string().describe('Parent widget application TypeID'),
      environment: z.string().min(1).max(80).describe('Environment name (e.g. "production")'),
      displayName: z.string().min(1).max(200).optional().describe('Display name'),
      enabled: z.boolean().optional().describe('Whether the profile is enabled (default true)'),
      allowedOrigins: z
        .array(z.string().min(1).max(300))
        .optional()
        .describe('Allowed origins for this environment'),
      configOverrides: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Config overrides JSON'),
      contentFilters: z.record(z.string(), z.unknown()).optional().describe('Content filters JSON'),
      supportConfig: z.record(z.string(), z.unknown()).optional().describe('Support config JSON'),
    },
    WRITE,
    async (args: {
      id?: string
      applicationId: string
      environment: string
      displayName?: string
      enabled?: boolean
      allowedOrigins?: string[]
      configOverrides?: Record<string, unknown>
      contentFilters?: Record<string, unknown>
      supportConfig?: Record<string, unknown>
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:config') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const profile = await upsertWidgetEnvironmentProfile({
          id: args.id,
          applicationId: args.applicationId,
          environment: args.environment,
          displayName: args.displayName,
          enabled: args.enabled,
          allowedOrigins: args.allowedOrigins,
          configOverrides: args.configOverrides,
          contentFilters: args.contentFilters,
          supportConfig: args.supportConfig,
        })
        if (!profile) {
          return errorResult(
            new Error(`Widget environment profile ${args.id} not found (or archived)`)
          )
        }
        return jsonResult(profile)
      } catch (err) {
        return errorResult(err)
      }
    }
  )
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

  // list_conversations
  server.tool(
    'list_conversations',
    `List support-inbox conversations, newest activity first. Filter by status, priority, or assigned agent; paginate with cursor.

Examples:
- Open conversations: list_conversations({ status: "open" })
- A specific agent's queue: list_conversations({ assignedAgentPrincipalId: "principal_01abc..." })`,
    {
      status: z.enum(CONVERSATION_STATUSES).optional().describe('Filter by status'),
      priority: z
        .enum(['none', 'low', 'medium', 'high', 'urgent'])
        .optional()
        .describe('Filter by priority'),
      assignedAgentPrincipalId: z
        .string()
        .optional()
        .describe('Filter to a specific assigned agent (principal TypeID)'),
      cursor: z.string().optional().describe('Pagination cursor from a previous response'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
    },
    READ_ONLY,
    async (args: {
      status?: 'open' | 'pending' | 'closed'
      priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
      assignedAgentPrincipalId?: string
      cursor?: string
      limit?: number
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { listConversationsForAgent } = await import('@/lib/server/domains/chat/chat.query')
        const result = await listConversationsForAgent({
          status: args.status,
          priority: args.priority,
          assignedAgentPrincipalId: args.assignedAgentPrincipalId as PrincipalId | undefined,
          before: args.cursor,
          limit: args.limit ?? 20,
        })
        return compactJsonResult({
          conversations: result.conversations.map((c) => ({
            id: c.id,
            status: c.status,
            priority: c.priority,
            channel: c.channel,
            subject: c.subject,
            lastMessageAt: c.lastMessageAt,
            visitorPrincipalId: c.visitor.principalId,
            assignedAgentPrincipalId: c.assignedAgent?.principalId ?? null,
          })),
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
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

  // list_ticket_attachments
  server.tool(
    'list_ticket_attachments',
    `List file-attachment metadata for one ticket thread.

Examples:
- list_ticket_attachments({ ticketId: "ticket_01...", threadId: "ticket_thread_01..." })`,
    {
      ticketId: ticketIdSchema,
      threadId: z.string().min(1),
    },
    READ_ONLY,
    async (args): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:tickets')
      if (denied) return denied
      try {
        const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
        if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const thread = await getThread(args.threadId as TicketThreadId)
        if (!thread || thread.ticketId !== args.ticketId) {
          return errorResult(
            new Error(`thread ${args.threadId} not found for ticket ${args.ticketId}`)
          )
        }
        const set = await loadPermissionSet(auth.principalId)
        if (!canViewTicket(set, loaded.scope)) {
          return errorResult(new Error('cannot view this ticket'))
        }
        const attachments = await listAttachmentsForThread(args.threadId as TicketThreadId)
        return compactJsonResult({ attachments })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_ticket_attachment
  server.tool(
    'manage_ticket_attachment',
    `Add or remove ticket attachment metadata. The file object must already exist in storage; this tool
does not upload bytes. Use storageKey/publicUrl from your upload pipeline.

Examples:
- Add metadata: manage_ticket_attachment({ action: "add", ticketId: "ticket_01...", threadId: "ticket_thread_01...", filename: "logs.txt", mimeType: "text/plain", sizeBytes: 2048, storageKey: "ticket-attachments/..." })
- Remove metadata: manage_ticket_attachment({ action: "remove", ticketId: "ticket_01...", threadId: "ticket_thread_01...", attachmentId: "ticket_att_01..." })`,
    {
      action: z.enum(['add', 'remove']),
      ticketId: ticketIdSchema,
      threadId: z.string().min(1),
      attachmentId: z.string().min(1).optional(),
      filename: z.string().min(1).max(256).optional(),
      mimeType: z.string().min(1).optional(),
      sizeBytes: z
        .number()
        .int()
        .positive()
        .max(50 * 1024 * 1024)
        .optional(),
      storageKey: z.string().min(1).optional(),
      publicUrl: z.string().nullable().optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'add' | 'remove'
      ticketId: string
      threadId: string
      attachmentId?: string
      filename?: string
      mimeType?: string
      sizeBytes?: number
      storageKey?: string
      publicUrl?: string | null
    }): Promise<CallToolResult> => {
      const scopeDenied = requireScope(auth, 'write:tickets')
      if (scopeDenied) return scopeDenied
      const roleDenied = requireTeamRole(auth)
      if (roleDenied) return roleDenied
      try {
        const loaded = await loadTicketResourceScope(args.ticketId as TicketId)
        if (!loaded) return errorResult(new Error(`ticket ${args.ticketId} not found`))
        const thread = await getThread(args.threadId as TicketThreadId)
        if (!thread || thread.deletedAt || thread.ticketId !== args.ticketId) {
          return errorResult(
            new Error(`thread ${args.threadId} not found for ticket ${args.ticketId}`)
          )
        }

        const set = await loadPermissionSet(auth.principalId)
        if (!canViewTicket(set, loaded.scope)) {
          return errorResult(new Error('cannot view this ticket'))
        }

        if (args.action === 'add') {
          if (!args.filename || !args.mimeType || !args.sizeBytes || !args.storageKey) {
            return errorResult(
              new Error(
                'filename, mimeType, sizeBytes, and storageKey are required for action "add"'
              )
            )
          }
          if (thread.audience === 'public' && !canReplyPublic(set, loaded.scope)) {
            return errorResult(new Error('cannot attach to public replies on this ticket'))
          }
          if (thread.audience === 'internal' && !canCommentInternal(set, loaded.scope)) {
            return errorResult(new Error('cannot attach to internal notes on this ticket'))
          }
          if (thread.audience === 'shared_team' && !canShareCrossTeam(set, loaded.scope)) {
            return errorResult(new Error('cannot attach to shared-team notes on this ticket'))
          }
          const attachment = await attachToThread({
            threadId: args.threadId as TicketThreadId,
            uploadedByPrincipalId: auth.principalId,
            filename: args.filename,
            mimeType: args.mimeType,
            sizeBytes: args.sizeBytes,
            storageKey: args.storageKey,
            publicUrl: args.publicUrl ?? null,
          })
          return jsonResult(attachment)
        }

        if (!args.attachmentId) {
          return errorResult(new Error('attachmentId is required for action "remove"'))
        }
        const attachments = await listAttachmentsForThread(args.threadId as TicketThreadId)
        const attachment = attachments.find((a) => a.id === args.attachmentId)
        if (!attachment) {
          return errorResult(new Error(`attachment ${args.attachmentId} not found on this thread`))
        }
        const isUploader =
          attachment.uploadedByPrincipalId !== null &&
          attachment.uploadedByPrincipalId === auth.principalId
        if (!isUploader && !canEditFields(set, loaded.scope)) {
          return errorResult(new Error('must be the uploader or hold ticket.edit_fields'))
        }
        await removeAttachment(args.attachmentId as TicketAttachmentId, auth.principalId)
        return jsonResult({ removed: true, id: args.attachmentId })
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

  // get_conversation
  server.tool(
    'get_conversation',
    `Get a conversation and its most recent messages. Set includeInternal to also return agent-only internal notes.

Example: get_conversation({ conversationId: "conversation_01abc...", includeInternal: true })`,
    {
      conversationId: z.string().describe('Conversation TypeID'),
      includeInternal: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include agent-only internal notes'),
      cursor: z
        .string()
        .optional()
        .describe('Cursor from a previous get_conversation response to fetch older messages'),
    },
    READ_ONLY,
    async (args: {
      conversationId: string
      includeInternal?: boolean
      cursor?: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { assertConversationViewable } =
          await import('@/lib/server/domains/chat/chat.service')
        const { listMessages, conversationToDTO } =
          await import('@/lib/server/domains/chat/chat.query')
        // team-role API key: canViewConversation short-circuits on role; segments unused
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const conversationId = args.conversationId as ConversationId
        const conversation = await assertConversationViewable(conversationId, actor)
        const [dto, page] = await Promise.all([
          conversationToDTO(conversation, 'agent'),
          listMessages(conversationId, {
            before: args.cursor,
            includeInternal: args.includeInternal ?? false,
            limit: 30,
          }),
        ])
        return jsonResult({
          conversation: {
            id: dto.id,
            status: dto.status,
            priority: dto.priority,
            channel: dto.channel,
            subject: dto.subject,
            visitorPrincipalId: dto.visitor.principalId,
            visitorEmail: realEmail(dto.visitorEmail),
            assignedAgentPrincipalId: dto.assignedAgent?.principalId ?? null,
            lastMessageAt: dto.lastMessageAt,
            resolvedAt: dto.resolvedAt,
            createdAt: dto.createdAt,
          },
          messages: page.messages.map((m) => ({
            id: m.id,
            senderType: m.senderType,
            isInternal: m.isInternal,
            authorName: m.author?.displayName ?? null,
            content: m.content,
            createdAt: m.createdAt,
          })),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
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

  // reply_to_conversation
  server.tool(
    'reply_to_conversation',
    `Send an agent reply in a conversation (visible to the visitor). Auto-assigns the conversation to the calling agent if unassigned.

Example: reply_to_conversation({ conversationId: "conversation_01abc...", content: "Thanks for reaching out — we're on it." })`,
    {
      conversationId: z.string().describe('Conversation TypeID'),
      content: z.string().min(1).max(4000).describe('Reply text sent to the visitor'),
    },
    WRITE,
    async (args: { conversationId: string; content: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { sendAgentMessage } = await import('@/lib/server/domains/chat/chat.service')
        // team-role API key: canActAsAgent short-circuits on role; segments unused
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const agent = agentFromMcpAuth(auth)
        const result = await sendAgentMessage(
          args.conversationId as ConversationId,
          args.content,
          agent,
          actor
        )
        return jsonResult({
          id: result.message.id,
          conversationId: result.message.conversationId,
          status: result.conversation.status,
          createdAt: result.message.createdAt,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // suggest_post — agent-only; nudges the team to track a RESOLVED conversation
  // as a post. Never reaches the visitor. The agent confirms with one click.
  server.tool(
    'suggest_post',
    `Suggest to the SUPPORT TEAM (not the visitor) that a RESOLVED conversation be tracked as a feedback post. Appears only in the agent inbox as an internal note; a team member confirms with one click. Rejected unless the conversation is resolved.

Example: suggest_post({ conversationId: "conversation_01...", boardId: "board_01...", title: "Add dark mode", content: "Customer asked for a night theme." })`,
    {
      conversationId: z.string().describe('Conversation TypeID (must be resolved)'),
      boardId: z.string().describe('Suggested board TypeID'),
      title: z.string().min(3).max(200),
      content: z.string().max(10000).default(''),
    },
    WRITE,
    async (args: {
      conversationId: string
      boardId: string
      title: string
      content: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { suggestPost } = await import('@/lib/server/domains/chat/chat.cards')
        // team-role API key: canActAsAgent short-circuits on role; segments unused
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const agent = agentFromMcpAuth(auth)
        const r = await suggestPost(
          {
            conversationId: args.conversationId as ConversationId,
            boardId: args.boardId as BoardId,
            title: args.title,
            content: args.content,
          },
          { agentActor: actor, agentPrincipalId: auth.principalId, agent }
        )
        return jsonResult({ messageId: r.messageId, conversationId: args.conversationId })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // share_post
  server.tool(
    'share_post',
    `Embed an EXISTING feedback post as a card in the chat so the visitor can view and upvote it. Find
candidates first with the search tool. Use to surface related ideas / avoid duplicates.

Example: share_post({ conversationId: "conversation_01...", postId: "post_01..." })`,
    {
      conversationId: z.string().describe('Conversation TypeID'),
      postId: z.string().describe('Post TypeID'),
    },
    WRITE,
    async (args: { conversationId: string; postId: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { sharePost } = await import('@/lib/server/domains/chat/chat.cards')
        // team-role API key: canActAsAgent short-circuits on role; segments unused
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const agent = agentFromMcpAuth(auth)
        const r = await sharePost(
          { conversationId: args.conversationId as ConversationId, postId: args.postId as PostId },
          { agentActor: actor, agentPrincipalId: auth.principalId, agent }
        )
        return jsonResult({ messageId: r.message.id })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // set_conversation_status
  server.tool(
    'set_conversation_status',
    `Change a conversation's status (open, pending, or closed). Closing stamps the resolution time; a later reply reopens it.

Example: set_conversation_status({ conversationId: "conversation_01abc...", status: "closed" })`,
    {
      conversationId: z.string().describe('Conversation TypeID'),
      status: z.enum(CONVERSATION_STATUSES).describe('New status'),
    },
    { ...WRITE, idempotentHint: true },
    async (args: {
      conversationId: string
      status: 'open' | 'pending' | 'closed'
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { setConversationStatus } = await import('@/lib/server/domains/chat/chat.service')
        // team-role API key: canActAsAgent short-circuits on role; segments unused
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const updated = await setConversationStatus(
          args.conversationId as ConversationId,
          args.status,
          actor
        )
        return jsonResult({ id: updated.id, status: updated.status })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // assign_conversation
  server.tool(
    'assign_conversation',
    `Assign a conversation to an agent (or unassign with agentPrincipalId: null).

Examples:
- Assign: assign_conversation({ conversationId: "conversation_01...", agentPrincipalId: "principal_01..." })
- Unassign: assign_conversation({ conversationId: "conversation_01...", agentPrincipalId: null })`,
    {
      conversationId: z.string().describe('Conversation TypeID'),
      agentPrincipalId: z
        .string()
        .nullable()
        .describe('Agent principal TypeID, or null to unassign'),
    },
    { ...WRITE, idempotentHint: true },
    async (args: {
      conversationId: string
      agentPrincipalId: string | null
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { assignConversation } = await import('@/lib/server/domains/chat/chat.service')
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const updated = await assignConversation(
          args.conversationId as ConversationId,
          (args.agentPrincipalId as PrincipalId | null) ?? null,
          actor
        )
        return jsonResult({
          id: updated.id,
          assignedAgentPrincipalId: updated.assignedAgentPrincipalId,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // set_conversation_priority
  server.tool(
    'set_conversation_priority',
    `Set a conversation's priority (none, low, medium, high, urgent).

Example: set_conversation_priority({ conversationId: "conversation_01...", priority: "high" })`,
    {
      conversationId: z.string().describe('Conversation TypeID'),
      priority: z.enum(CONVERSATION_PRIORITIES).describe('New priority'),
    },
    { ...WRITE, idempotentHint: true },
    async (args: {
      conversationId: string
      priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { setConversationPriority } = await import('@/lib/server/domains/chat/chat.service')
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const updated = await setConversationPriority(
          args.conversationId as ConversationId,
          args.priority,
          actor
        )
        return jsonResult({ id: updated.id, priority: updated.priority })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // add_conversation_note
  server.tool(
    'add_conversation_note',
    `Add an internal note to a conversation (never visible to the visitor).

Example: add_conversation_note({ conversationId: "conversation_01...", content: "Customer is on the enterprise plan." })`,
    {
      conversationId: z.string().describe('Conversation TypeID'),
      content: z.string().min(1).max(10000).describe('Internal note body'),
    },
    WRITE,
    async (args: { conversationId: string; content: string }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const { addAgentNote } = await import('@/lib/server/domains/chat/chat.service')
        const actor = {
          principalId: auth.principalId,
          role: auth.role,
          principalType: auth.userId ? ('user' as const) : ('service' as const),
          segmentIds: new Set<SegmentId>(),
        }
        const agent = agentFromMcpAuth(auth)
        const result = await addAgentNote(
          args.conversationId as ConversationId,
          args.content,
          agent,
          actor
        )
        return jsonResult({
          id: result.message.id,
          conversationId: result.message.conversationId,
          createdAt: result.message.createdAt,
        })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // list_chat_tags
  server.tool(
    'list_chat_tags',
    `List conversation tags ("labels") with their usage counts.

Example: list_chat_tags({})`,
    {},
    READ_ONLY,
    async (): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'read:chat')
      if (denied) return denied
      try {
        const { listChatTagsWithCounts } =
          await import('@/lib/server/domains/chat/chat-tag.service')
        return jsonResult({ tags: await listChatTagsWithCounts() })
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // manage_chat_tag
  server.tool(
    'manage_chat_tag',
    `Create, update, or delete a conversation tag.

Examples:
- Create: manage_chat_tag({ action: "create", name: "vip", color: "#f59e0b" })
- Update: manage_chat_tag({ action: "update", chatTagId: "chat_tag_01...", name: "priority" })
- Delete: manage_chat_tag({ action: "delete", chatTagId: "chat_tag_01..." })`,
    {
      action: z.enum(['create', 'update', 'delete']),
      chatTagId: z.string().optional().describe('Required for update and delete'),
      name: z.string().max(80).optional(),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
    },
    DESTRUCTIVE,
    async (args: {
      action: 'create' | 'update' | 'delete'
      chatTagId?: string
      name?: string
      color?: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/chat/chat-tag.service')
        if (args.action === 'create') {
          if (!args.name) return errorResult(new Error('name is required when action is "create"'))
          return jsonResult(await svc.createChatTag({ name: args.name, color: args.color }))
        }
        if (!args.chatTagId) return errorResult(new Error('chatTagId is required'))
        if (args.action === 'delete') {
          await svc.deleteChatTag(args.chatTagId as ChatTagId)
          return jsonResult({ deleted: true, id: args.chatTagId })
        }
        return jsonResult(
          await svc.updateChatTag(args.chatTagId as ChatTagId, {
            name: args.name,
            color: args.color,
          })
        )
      } catch (err) {
        return errorResult(err)
      }
    }
  )

  // tag_conversation
  server.tool(
    'tag_conversation',
    `Attach or detach a conversation tag on a conversation.

Examples:
- Attach: tag_conversation({ action: "attach", conversationId: "conversation_01...", chatTagId: "chat_tag_01..." })
- Detach: tag_conversation({ action: "detach", conversationId: "conversation_01...", chatTagId: "chat_tag_01..." })`,
    {
      action: z.enum(['attach', 'detach']),
      conversationId: z.string(),
      chatTagId: z.string(),
    },
    { ...WRITE, idempotentHint: true },
    async (args: {
      action: 'attach' | 'detach'
      conversationId: string
      chatTagId: string
    }): Promise<CallToolResult> => {
      const denied = requireScope(auth, 'write:chat') ?? requireTeamRole(auth)
      if (denied) return denied
      try {
        const svc = await import('@/lib/server/domains/chat/chat-tag.service')
        const tags =
          args.action === 'attach'
            ? await svc.attachTag(
                args.conversationId as ConversationId,
                args.chatTagId as ChatTagId
              )
            : await svc.detachTag(
                args.conversationId as ConversationId,
                args.chatTagId as ChatTagId
              )
        return jsonResult({ conversationId: args.conversationId, tags })
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
    content: contentJsonToMarkdown(entry.contentJson, entry.content),
    status: entry.status,
    authorName: entry.author?.name ?? null,
    category: entry.category,
    product: entry.product,
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

async function getArticleDetails(articleId: HelpCenterArticleId): Promise<CallToolResult> {
  const article = await getArticleById(articleId)
  return articleResult(article)
}

async function getCategoryDetails(categoryId: HelpCenterCategoryId): Promise<CallToolResult> {
  const category = await getCategoryById(categoryId)
  return categoryResult(category)
}
