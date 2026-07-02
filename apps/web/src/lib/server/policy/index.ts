/**
 * Feedback / Portal authorization layer.
 *
 * Covers: boards, posts, comments, chat/conversation visibility.
 *
 * Design: 3-role model (admin | member | user) with 4-tier access gates:
 *   anonymous → authenticated → segments → team
 * Each resource exposes `canX(actor, resource): Decision` for single-row
 * checks and `xFilter(actor): SQL` for composable list-query predicates.
 *
 * For ticketing/CRM authorization (tickets, teams, inboxes, SLA, contacts,
 * organizations), use `@/lib/server/domains/authz` instead — it uses a
 * fine-grained RBAC permission catalogue with team-scoped narrowing.
 */
export * from './types'
export * from './boards'
export * from './posts'
export * from './support'
