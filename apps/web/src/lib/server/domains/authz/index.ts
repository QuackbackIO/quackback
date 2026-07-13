/**
 * Ticketing / CRM RBAC authorization layer.
 *
 * Covers: tickets, teams, inboxes, SLA policies, contacts, organizations,
 * and workspace admin operations.
 *
 * Design: 30+ dotted permission keys (e.g. `ticket.view_all`) organized into
 * categories, assigned to 5 system roles (owner, supervisor, agent,
 * collaborator, customer), with team-scope narrowing for view permissions.
 *
 * Legacy fallback: when no `principal_role_assignments` exist for a principal,
 * the system maps `principal.role` → system role:
 *   admin → owner, member → agent, user → customer.
 *
 * For feedback portal authorization (boards, posts, comments, chat), use
 * `@/lib/server/policy` instead — it uses a simpler tier-based access model.
 *
 * Service functions are server-only; types and the permission catalogue are
 * safe to import from client code (e.g. for UI capability checks).
 */

export {
  PERMISSIONS,
  PERMISSION_CATEGORIES,
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  type PermissionKey,
  type SystemRoleKey,
} from './authz.permissions'

export type { ActorScope, ResourceScope, ScopeMatch } from './authz.scopes'
