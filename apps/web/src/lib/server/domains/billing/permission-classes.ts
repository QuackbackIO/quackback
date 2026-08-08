/**
 * Which permissions let a teammate **act on the customer-support surface**.
 *
 * This exists for exactly one purpose: deciding whether a teammate occupies a
 * full seat or a reduced-rate ("lite") seat. It is a **billing** judgement,
 * not an authorization one, which is why it lives in this module and not in
 * `lib/shared/permissions.ts` — nothing in the policy layer reads it, and
 * nothing here may ever be used to decide access.
 *
 * ## The operator's definition
 *
 * > *A lite seat is read-only on the customer support side.*
 *
 * So the question is deliberately **narrow**: not "can this person change
 * anything anywhere", but "can this person act on conversations, tickets and
 * the inbox". A product manager who writes freely on feedback boards and
 * roadmaps but only *observes* the support inbox is a **lite** seat. Full
 * seats are support agents; lite seats are everyone else who needs visibility.
 *
 * An earlier version of this file implemented the competing reading —
 * globally read-only, with support merely being where it mattered — which
 * classified that same product manager as full. Both readings are recorded in
 * BILLING.md with this one marked as chosen, because the difference decides
 * money and should be reversible by editing one list rather than by
 * re-deriving the model.
 *
 * ## How the surface is derived
 *
 * From the permission catalogue's own `category` field, not from a name
 * prefix. The catalogue's header is explicit that presets and boundaries are
 * enumerated rather than prefix-filtered, and a `.view` suffix test misfiles
 * `post.view_private` (read), `copilot.use` (an agent tool) and
 * `status_page.publish` (a write). Categories are data the catalogue already
 * maintains, so a permission added to a support category is pulled into the
 * surface automatically — and then fails CI until it is classified.
 */

import {
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  type PermissionCategory,
  type PermissionKey,
} from '@/lib/shared/permissions'

/**
 * Catalogue categories that constitute the customer-support surface.
 *
 * `conversation` is the messenger inbox; `support` is tickets, SLAs, office
 * hours, routing, teams, connected channels and workflow automation — the
 * operations that decide what a customer receives and when.
 *
 * Everything else is deliberately outside: feedback and roadmaps, changelog,
 * help centre, status page, analytics, and workspace administration. Writing
 * there does not make a seat a support seat, which is the whole point of the
 * operator's phrasing.
 */
export const SUPPORT_SURFACE_CATEGORIES: readonly PermissionCategory[] = [
  'conversation',
  'support',
]

/**
 * Permissions that act on the support surface but are filed under another
 * category, so the category derivation alone would miss them.
 *
 * A named, reviewable exception list rather than a widened category rule.
 * Today it holds one entry:
 *
 * - `copilot.use` — *"Use the agent-facing Copilot assistant in the inbox"*.
 *   Categorised under `ai`, but it is an agent tool operating inside a
 *   conversation, and it spends real money doing so. Treating it as a support
 *   action is a judgement call and is flagged as such in BILLING.md.
 *
 * `assistant.manage` is **not** here, and that is an open question rather than
 * a settled call — it is with the operator, because it moves money. Both sides:
 *
 * - *Leave it off.* Configuring how the AI agent behaves is workspace
 *   administration in the same class as `settings.manage`. It is reached from
 *   the automation settings area, not from the inbox.
 * - *Put it on.* The inclusion rule used for `sla.manage`, `routing.manage`
 *   and `workflow.manage` is "none touches a single conversation directly,
 *   but each decides what happens to every conversation" — and
 *   `assistant.manage` gates the agent's persona, guidance, custom actions and
 *   knowledge, which is what every customer is automatically told. As it
 *   stands this file calls *using* Copilot a support write and *configuring*
 *   it not one, which is hard to defend as a distinction.
 *
 * Moving it is one line here plus the classification below; the tests name the
 * cases that would change.
 */
export const SUPPORT_SURFACE_EXTRAS: readonly PermissionKey[] = [PERMISSIONS.COPILOT_USE]

/** Every permission on the customer-support surface, derived from the catalogue. */
export const SUPPORT_SURFACE_PERMISSIONS: readonly PermissionKey[] = [
  ...PERMISSION_CATALOGUE.filter((entry) =>
    SUPPORT_SURFACE_CATEGORIES.includes(entry.category)
  ).map((entry) => entry.key),
  ...SUPPORT_SURFACE_EXTRAS,
]

/**
 * Support-surface permissions that only widen what a teammate can see.
 *
 * A teammate holding none of {@link SUPPORT_WRITE_PERMISSIONS} occupies a
 * lite seat, whatever else they can do elsewhere in the product.
 */
export const SUPPORT_READ_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_VIEW_ALL,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_VIEW_ALL,
]

/**
 * Support-surface permissions that let a teammate change something a customer
 * or another agent would observe. Holding any one makes the seat a full seat.
 *
 * The borderline calls, stated because they are the ones someone will query:
 *
 * - `conversation.manage_views` and `conversation.manage_tags` are **writes**.
 *   They shape the taxonomy and the queues every agent works from; a viewer
 *   who can rename the team's views is not read-only in any useful sense.
 * - `team.manage`, `routing.manage`, `sla.manage`, `office_hours.manage`,
 *   `channel_account.manage`, `ticket.manage_types` and `workflow.manage` are
 *   **writes**. None of them touches a single conversation directly, but each
 *   decides what happens to every conversation — which is a support action by
 *   any reading that is not purely literal.
 * - `copilot.use` is a **write**: an agent tool that acts inside a thread and
 *   spends AI budget doing it.
 */
export const SUPPORT_WRITE_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.CONVERSATION_NOTE,
  PERMISSIONS.CONVERSATION_ASSIGN,
  PERMISSIONS.CONVERSATION_MANAGE,
  PERMISSIONS.CONVERSATION_SET_STATUS,
  PERMISSIONS.CONVERSATION_SET_TAGS,
  PERMISSIONS.CONVERSATION_MANAGE_TAGS,
  PERMISSIONS.CONVERSATION_MANAGE_VIEWS,
  PERMISSIONS.CONVERSATION_SET_ATTRIBUTES,
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
  PERMISSIONS.COPILOT_USE,
]

/** Every classified support-surface key, for the totality assertion in the tests. */
export const CLASSIFIED_SUPPORT_PERMISSIONS: readonly PermissionKey[] = [
  ...SUPPORT_READ_PERMISSIONS,
  ...SUPPORT_WRITE_PERMISSIONS,
]

/**
 * Support-surface keys no list above mentions. Empty, enforced by test.
 *
 * This is the anti-rot mechanism: a permission added to the `conversation` or
 * `support` category joins the surface automatically and then fails CI until
 * someone decides whether it is a support write. Forgetting would otherwise
 * silently reclassify seats and change invoices.
 */
export function unclassifiedSupportPermissions(): PermissionKey[] {
  const classified = new Set<PermissionKey>(CLASSIFIED_SUPPORT_PERMISSIONS)
  return SUPPORT_SURFACE_PERMISSIONS.filter((key) => !classified.has(key))
}

/** Classified keys that are not on the surface at all. Empty, enforced by test. */
export function offSurfaceClassifications(): PermissionKey[] {
  const surface = new Set<PermissionKey>(SUPPORT_SURFACE_PERMISSIONS)
  return CLASSIFIED_SUPPORT_PERMISSIONS.filter((key) => !surface.has(key))
}
