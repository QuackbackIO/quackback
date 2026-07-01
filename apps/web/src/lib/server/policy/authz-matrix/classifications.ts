/**
 * Hand-declared intent for every authorization site the scanner finds that is
 * NOT a self-describing catalogue-permission gate.
 *
 * A `requireAuth({ permission: PERMISSIONS.X })` gate carries its own
 * expectation — the permission IS the contract. Everything else needs a human
 * to state intent so the matrix (and its reviewers) can tell an END_USER action
 * apart from an accidental hole:
 *   - bare `requireAuth()`      — an end-user action, or a team-any read
 *   - bare `withApiKeyAuth(req)` — a public-tier REST read (any valid key)
 *   - `requireTeamAuth()`        — a local wrapper that resolves to a permission
 *   - inline `isAdmin` / `isTeamMember` — either the real access decision
 *     (SECONDARY_GATE) or a behavior refinement behind an existing gate
 *     (NOT_A_GATE)
 *
 * The reconciliation test asserts this list and the live scan stay in lockstep:
 * a new bare/alias/inline site with no entry fails CI, and a stale entry with no
 * matching site fails too. That is the "every surface has an explicit auth
 * expectation" gate from the feature request.
 */
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

export type SurfaceIntent =
  /** Bare `requireAuth()`: any authenticated principal (team, portal, or widget). */
  | 'END_USER'
  /** Bare `withApiKeyAuth(req)`: any valid API key, no permission; public-tier data. */
  | 'PUBLIC_DATA'
  /** The MCP handler's bare `withApiKeyAuth(req)`: a valid key enters; per-tool scopes authorize. */
  | 'MCP_ENTRY'
  /** Bare gate whose required permission is computed from the request (a field-scoped PATCH): a valid key authenticates, then `assertApiPermissions` enforces the permission for each field touched. No single static permission covers it. */
  | 'DYNAMIC_PERMISSION'
  /** An inline role check that IS the access decision for a surface without a requireAuth/key gate. */
  | 'SECONDARY_GATE'
  /** An inline role check that refines behavior behind an already-present gate — not an entry point. */
  | 'NOT_A_GATE'

export interface Classification {
  intent: SurfaceIntent
  /** For SECONDARY_GATE: the role bar the inline check enforces (`admin` throws for members too). */
  roleBar?: 'admin' | 'team'
  /** For SECONDARY_GATE: the catalogue permission the check mirrors, when it maps to one. */
  resolvesTo?: PermissionKey
  /** For DYNAMIC_PERMISSION: the closed set of permissions the runtime check may require (one per patchable field). */
  resolvesToAny?: readonly PermissionKey[]
  why: string
}

/** Stable key for a gate surface: file + enclosing declaration / HTTP method. */
export function gateKey(file: string, surface: string): string {
  return `${file}::${surface}`
}

/** Stable key for an inline role check: gate surface + the predicate called. */
export function inlineKey(file: string, surface: string, callee: string): string {
  return `${file}::${surface}::${callee}`
}

/** `requireTeamAuth()` wraps `requireAuth({ permission: POST_APPROVE })`. */
export const ALIAS_RESOLUTIONS: Record<string, PermissionKey> = {
  requireTeamAuth: PERMISSIONS.POST_APPROVE,
}

// ---------------------------------------------------------------------------
// Bare gates — keyed by gateKey(file, surface)
// ---------------------------------------------------------------------------

const END_USER = (why: string): Classification => ({ intent: 'END_USER', why })
const PUBLIC_DATA = (why: string): Classification => ({ intent: 'PUBLIC_DATA', why })
const DYNAMIC_PERMISSION = (
  resolvesToAny: readonly PermissionKey[],
  why: string
): Classification => ({ intent: 'DYNAMIC_PERMISSION', resolvesToAny, why })

export const BARE_GATE_CLASSIFICATIONS: Record<string, Classification> = {
  // Visitor chat (widget + portal): any authenticated principal; team-vs-visitor
  // scope is refined inside each handler (see NOT_A_GATE entries below).
  'lib/server/functions/chat.ts::sendConversationMessageFn': END_USER(
    'visitor sends a chat message'
  ),
  'lib/server/functions/chat.ts::listConversationMessagesFn': END_USER(
    'visitor pages their own chat'
  ),
  'lib/server/functions/chat.ts::markChatReadFn': END_USER('visitor marks their chat read'),
  'lib/server/functions/chat.ts::sendChatTypingFn': END_USER('visitor typing indicator'),
  'lib/server/functions/chat.ts::submitCsatFn': END_USER('visitor submits a CSAT rating'),
  'lib/server/functions/chat.ts::mintChatStreamTokenFn': END_USER(
    'visitor mints their SSE stream token'
  ),
  'lib/server/functions/chat.ts::deleteConversationMessageFn': END_USER(
    'author deletes their own chat message'
  ),

  // Comments / reactions: end-user create + own-edit/delete.
  'lib/server/functions/comments.ts::createCommentFn': END_USER('end-user posts a comment'),
  'lib/server/functions/comments.ts::addReactionFn': END_USER('end-user adds a reaction'),
  'lib/server/functions/comments.ts::removeReactionFn': END_USER('end-user removes their reaction'),
  'lib/server/functions/comments.ts::userEditCommentFn': END_USER('author edits their own comment'),
  'lib/server/functions/comments.ts::userDeleteCommentFn': END_USER(
    'author deletes their own comment'
  ),

  // Own-account + own-content end-user actions.
  'lib/server/functions/link-preview.ts::unfurlLinkFn': END_USER('link unfurl for the composer'),
  'lib/server/functions/notifications.ts::getNotificationsFn': END_USER('own notifications list'),
  'lib/server/functions/notifications.ts::getUnreadCountFn': END_USER('own unread count'),
  'lib/server/functions/notifications.ts::markNotificationAsReadFn': END_USER(
    'mark own notification read'
  ),
  'lib/server/functions/notifications.ts::markAllNotificationsAsReadFn': END_USER(
    'mark all own notifications read'
  ),
  'lib/server/functions/notifications.ts::archiveNotificationFn': END_USER(
    'archive own notification'
  ),
  'lib/server/functions/portal.ts::fetchSubscriptionStatus': END_USER(
    'own subscription status (portal)'
  ),
  'lib/server/functions/public-posts.ts::userEditPostFn': END_USER('author edits their own post'),
  'lib/server/functions/public-posts.ts::userDeletePostFn': END_USER(
    'author deletes their own post'
  ),
  'lib/server/functions/public-posts.ts::toggleVoteFn': END_USER('end-user votes on a post'),
  'lib/server/functions/public-posts.ts::createPublicPostFn': END_USER('end-user submits a post'),
  'lib/server/functions/subscriptions.ts::fetchSubscriptionStatus':
    END_USER('own subscription status'),
  'lib/server/functions/subscriptions.ts::subscribeToPostFn': END_USER('subscribe self to a post'),
  'lib/server/functions/subscriptions.ts::unsubscribeFromPostFn': END_USER(
    'unsubscribe self from a post'
  ),
  'lib/server/functions/subscriptions.ts::updateSubscriptionLevelFn': END_USER(
    'update own subscription level'
  ),
  'lib/server/functions/uploads.ts::getAvatarUploadUrlFn': END_USER('own avatar upload URL'),
  'lib/server/functions/user.ts::requirePrincipalId': END_USER(
    'own-profile helper — resolves the caller principal'
  ),

  // MCP transport entry: a valid key authenticates; per-tool scopes authorize
  // (see MCP_TOOLS). Not a permission gate on its own.
  'lib/server/mcp/handler.ts::resolveAuthContext': {
    intent: 'MCP_ENTRY',
    why: 'MCP transport entry — a valid key authenticates; per-tool scopes provide authorization',
  },

  // Field-scoped write: a valid key authenticates, then assertApiPermissions
  // enforces the permission for each field the PATCH touches (title/content ->
  // post.edit, statusId -> post.set_status, tagIds -> post.set_tags,
  // ownerPrincipalId -> post.set_owner). No single static permission covers it.
  'routes/api/v1/posts/$postId.ts::PATCH': DYNAMIC_PERMISSION(
    [
      PERMISSIONS.POST_EDIT,
      PERMISSIONS.POST_SET_STATUS,
      PERMISSIONS.POST_SET_TAGS,
      PERMISSIONS.POST_SET_OWNER,
    ],
    'field-scoped post PATCH — assertApiPermissions authorizes per changed field'
  ),

  // Public-tier REST reads: a valid key is required, but the data is portal-public
  // so no permission is checked. Anonymous (no key) is still rejected.
  'routes/api/v1/apps/boards.ts::GET': PUBLIC_DATA('public board list'),
  'routes/api/v1/boards/$boardId.ts::GET': PUBLIC_DATA('public board'),
  'routes/api/v1/boards/index.ts::GET': PUBLIC_DATA('public board list'),
  'routes/api/v1/help-center/articles/$articleId.feedback.ts::POST':
    PUBLIC_DATA('end-user article rating'),
  'routes/api/v1/help-center/articles/$articleId.ts::GET': PUBLIC_DATA('public help article'),
  'routes/api/v1/help-center/articles/index.ts::GET': PUBLIC_DATA('public help article list'),
  'routes/api/v1/help-center/categories/$categoryId.ts::GET': PUBLIC_DATA('public help category'),
  'routes/api/v1/help-center/categories/index.ts::GET': PUBLIC_DATA('public help category list'),
  'routes/api/v1/roadmaps/$roadmapId.posts.ts::GET': PUBLIC_DATA('public roadmap posts'),
  'routes/api/v1/roadmaps/$roadmapId.ts::GET': PUBLIC_DATA('public roadmap'),
  'routes/api/v1/roadmaps/index.ts::GET': PUBLIC_DATA('public roadmap list'),
  'routes/api/v1/statuses/$statusId.ts::GET': PUBLIC_DATA('public status'),
  'routes/api/v1/statuses/index.ts::GET': PUBLIC_DATA('public status list'),
  'routes/api/v1/tags/$tagId.ts::GET': PUBLIC_DATA('public tag'),
  'routes/api/v1/tags/index.ts::GET': PUBLIC_DATA('public tag list'),
}

// ---------------------------------------------------------------------------
// Inline role checks — keyed by inlineKey(file, surface, callee)
// ---------------------------------------------------------------------------

const NOT_A_GATE = (why: string): Classification => ({ intent: 'NOT_A_GATE', why })

export const INLINE_CLASSIFICATIONS: Record<string, Classification> = {
  // Real access decisions the requireAuth/withApiKeyAuth scan does NOT cover —
  // surfaced precisely because a stray change here would widen access silently.
  'routes/api/chat/stream.ts::GET::isTeamMember': {
    intent: 'SECONDARY_GATE',
    roleBar: 'team',
    resolvesTo: PERMISSIONS.CONVERSATION_VIEW,
    why: 'SSE stream: the inbox and presence scopes are team-only; the conversation scope is gated by canViewConversation',
  },
  'lib/server/functions/onboarding.ts::setupWorkspaceFn::isAdmin': {
    intent: 'SECONDARY_GATE',
    roleBar: 'admin',
    why: 'onboarding bootstrap: the first authenticated user provisions as admin; once the workspace step is done, completing setup requires an existing admin',
  },

  // Behavior refinements sitting behind an already-present entry gate.
  'lib/server/functions/admin.ts::checkOnboardingState::isAdmin': NOT_A_GATE(
    'race-safe first-user promotion — not an access check'
  ),
  'lib/server/functions/onboarding.ts::ensureAdminPrincipal::isAdmin': NOT_A_GATE(
    'promotes an existing non-admin principal during bootstrap — not an access check'
  ),
  'lib/server/functions/chat.ts::assertVisitorChatAccess::isTeamMember': NOT_A_GATE(
    'team bypasses the portal-access check; entry is the bare requireAuth on each caller'
  ),
  'lib/server/functions/chat.ts::sendConversationMessageFn::isTeamMember': NOT_A_GATE(
    'team skips the per-visitor send-rate throttle'
  ),
  'lib/server/functions/chat.ts::getMyChatFn::isTeamMember': NOT_A_GATE(
    'non-team callers gated behind portal access; team reads from the admin inbox'
  ),
  'lib/server/functions/chat.ts::getMyConversationsFn::isTeamMember': NOT_A_GATE(
    'non-team callers gated behind portal access; team reads from the admin inbox'
  ),
  'lib/server/functions/chat.ts::listConversationMessagesFn::isTeamMember': NOT_A_GATE(
    'internal notes are agent-only; visitors never see them'
  ),
  'lib/server/functions/link-preview.ts::unfurlLinkFn::isTeamMember': NOT_A_GATE(
    'team bypasses the portal-access check; entry is the bare requireAuth'
  ),
  'lib/server/functions/portal.ts::fetchPublicRoadmapPosts::isTeamMember': NOT_A_GATE(
    'only team may narrow by segment; non-team callers silently ignore segmentIds'
  ),
  'routes/api/v1/principals/$principalId.ts::fetchTeamMemberWithUser::isTeamMember': NOT_A_GATE(
    'route is already key-gated (member.view/manage); this returns 404 for non-team principals'
  ),
}
