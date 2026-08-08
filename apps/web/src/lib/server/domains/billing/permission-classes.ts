/**
 * Read-only vs write classification of the permission catalogue.
 *
 * This exists for exactly one purpose: deciding whether a teammate occupies a
 * full seat or a reduced-rate ("lite") seat. It is a **billing** judgement,
 * not an authorization one, which is why it lives in this module and not in
 * `lib/shared/permissions.ts` — nothing in the policy layer reads it, and
 * nothing here may ever be used to decide access.
 *
 * ## Why two explicit lists rather than a suffix test
 *
 * The catalogue's own header says it plainly: *"Presets and the admin boundary
 * are explicit permission lists (never string-prefix filters), so adding a key
 * can never silently widen a role."* Classifying by a `.view` suffix would
 * break that rule and would misfile anything whose name does not follow it —
 * `post.view_private` reads, `copilot.use` writes, `status_page.publish`
 * publishes.
 *
 * The partition is total and disjoint, and `permission-classes.test.ts`
 * asserts that against the live `ALL_PERMISSIONS`. So a permission added next
 * year fails CI until someone classifies it, rather than silently defaulting
 * into whichever bucket happens to over- or under-charge.
 *
 * ## The judgement call in the borderline cases
 *
 * "Read-only" here means *cannot change anything a customer or a teammate
 * would observe*. Consequences of that reading, stated because they are the
 * cases someone will query:
 *
 *   - `copilot.use` is a **write**. It spends money (AI tokens) and posts
 *     drafts; it is also separately billed as the Copilot add-on, so a seat
 *     holding it is not a passive viewer by any definition.
 *   - `post.view_private`, `comment.view_private`, `changelog.view_draft`,
 *     `conversation.view_all`, `ticket.view_all` are **read-only**. They
 *     widen what is visible, never what is mutable.
 *   - `audit.view` and `analytics.view` are **read-only** even though they
 *     are workspace-admin permissions. Sensitivity is not mutability, and the
 *     question this file answers is only "can this person change things".
 *   - `webhook.view` is **read-only**; `webhook.manage` (which can read back
 *     a signing secret) is a write.
 */

import { ALL_PERMISSIONS, PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

/**
 * Permissions that only widen what a teammate can see.
 *
 * A teammate whose entire effective set is drawn from this list occupies a
 * lite seat.
 */
export const READ_ONLY_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.WEBHOOK_VIEW,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.MEMBER_VIEW,
  PERMISSIONS.PEOPLE_VIEW,
  PERMISSIONS.COMPANY_VIEW,
  PERMISSIONS.SEGMENT_VIEW,
  PERMISSIONS.USER_ATTRIBUTE_VIEW,
  PERMISSIONS.POST_VIEW_PRIVATE,
  PERMISSIONS.COMMENT_VIEW_PRIVATE,
  PERMISSIONS.STATUS_VIEW,
  PERMISSIONS.TAG_VIEW,
  PERMISSIONS.SUGGESTION_VIEW,
  PERMISSIONS.CHANGELOG_VIEW_DRAFT,
  PERMISSIONS.SURVEY_VIEW,
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_VIEW_ALL,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.INTEGRATION_VIEW,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_VIEW_ALL,
]

/**
 * Permissions that let a teammate change something. Holding any one of these
 * makes the seat a full seat.
 */
export const WRITE_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SETTINGS_BRANDING,
  PERMISSIONS.SETTINGS_MODERATION,
  PERMISSIONS.SETTINGS_NOTIFICATIONS,
  PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.ROLE_MANAGE,
  PERMISSIONS.API_KEY_MANAGE,
  PERMISSIONS.WEBHOOK_MANAGE,
  PERMISSIONS.AUTH_MANAGE,
  PERMISSIONS.CUSTOM_FIELD_MANAGE,
  PERMISSIONS.MEMBER_MANAGE,
  PERMISSIONS.PEOPLE_MANAGE,
  PERMISSIONS.COMPANY_MANAGE,
  PERMISSIONS.SEGMENT_MANAGE,
  PERMISSIONS.USER_ATTRIBUTE_MANAGE,
  PERMISSIONS.POST_CREATE,
  PERMISSIONS.POST_EDIT,
  PERMISSIONS.POST_DELETE,
  PERMISSIONS.POST_SET_STATUS,
  PERMISSIONS.POST_SET_BOARD,
  PERMISSIONS.POST_SET_TAGS,
  PERMISSIONS.POST_SET_OWNER,
  PERMISSIONS.POST_SET_AUTHOR,
  PERMISSIONS.POST_MERGE,
  PERMISSIONS.POST_EXPORT,
  PERMISSIONS.POST_SET_PINNED,
  PERMISSIONS.POST_SET_ETA,
  PERMISSIONS.POST_APPROVE,
  PERMISSIONS.POST_VOTE_ON_BEHALF,
  PERMISSIONS.COMMENT_MODERATE,
  PERMISSIONS.COMMENT_EDIT,
  PERMISSIONS.COMMENT_PIN,
  PERMISSIONS.BOARD_MANAGE,
  PERMISSIONS.ROADMAP_MANAGE,
  PERMISSIONS.STATUS_MANAGE,
  PERMISSIONS.TAG_MANAGE,
  PERMISSIONS.SUGGESTION_MANAGE,
  PERMISSIONS.PRIORITIZATION_MANAGE,
  PERMISSIONS.CHANGELOG_MANAGE,
  PERMISSIONS.HELP_CENTER_MANAGE,
  PERMISSIONS.SURVEY_MANAGE,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.CONVERSATION_NOTE,
  PERMISSIONS.CONVERSATION_ASSIGN,
  PERMISSIONS.CONVERSATION_MANAGE,
  PERMISSIONS.CONVERSATION_SET_STATUS,
  PERMISSIONS.CONVERSATION_SET_TAGS,
  PERMISSIONS.CONVERSATION_MANAGE_TAGS,
  PERMISSIONS.CONVERSATION_MANAGE_VIEWS,
  PERMISSIONS.CONVERSATION_SET_ATTRIBUTES,
  PERMISSIONS.INTEGRATION_MANAGE,
  PERMISSIONS.TICKET_REPLY,
  PERMISSIONS.TICKET_NOTE,
  PERMISSIONS.TICKET_ASSIGN,
  PERMISSIONS.TICKET_SET_STATUS,
  PERMISSIONS.TICKET_CREATE,
  PERMISSIONS.TICKET_MANAGE_TYPES,
  PERMISSIONS.SLA_MANAGE,
  PERMISSIONS.OFFICE_HOURS_MANAGE,
  PERMISSIONS.ROUTING_MANAGE,
  PERMISSIONS.TEAM_MANAGE,
  PERMISSIONS.WORKFLOW_MANAGE,
  PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
  PERMISSIONS.ASSISTANT_MANAGE,
  PERMISSIONS.COPILOT_USE,
  PERMISSIONS.STATUS_PAGE_MANAGE,
  PERMISSIONS.STATUS_PAGE_PUBLISH,
]

/** Every classified key, for the totality assertion in the tests. */
export const CLASSIFIED_PERMISSIONS: readonly PermissionKey[] = [
  ...READ_ONLY_PERMISSIONS,
  ...WRITE_PERMISSIONS,
]

/** Keys in the live catalogue that no list above mentions. Empty, enforced by test. */
export function unclassifiedPermissions(): PermissionKey[] {
  const classified = new Set<PermissionKey>(CLASSIFIED_PERMISSIONS)
  return ALL_PERMISSIONS.filter((key) => !classified.has(key))
}
