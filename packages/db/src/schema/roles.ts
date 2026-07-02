/**
 * RBAC schema — roles, permissions, role-permission grants, role assignments.
 *
 * This is the source of truth for "what can a principal do?". The legacy
 * `principal.role` column (admin | member | user) is preserved as a denormalised
 * cache and is kept in sync via the authz service. Existing call sites that
 * use `requireAuth({ roles: ['admin'] })` keep working through a compatibility
 * shim in `auth-helpers.ts`.
 *
 * Concepts:
 *   - role: a named bundle (e.g. "supervisor", "agent", "collaborator").
 *   - permission: a fine-grained verb (e.g. "ticket.reply_public").
 *   - role_permissions: which permissions belong to a role.
 *   - principal_role_assignments: which roles a principal holds, optionally
 *     scoped to a team (NULL team_id = workspace-wide).
 *
 * `is_system` rows are seeded by migrations and cannot be deleted from the UI.
 */
import { pgTable, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { teams } from './teams'

export const roles = pgTable(
  'roles',
  {
    id: typeIdWithDefault('role')('id').primaryKey(),
    /** Stable machine name; UI labels live in i18n locale files. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Seeded by migrations; not deletable from the UI. */
    isSystem: boolean('is_system').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex('roles_key_idx').on(t.key)]
)

export const permissions = pgTable(
  'permissions',
  {
    id: typeIdWithDefault('perm')('id').primaryKey(),
    /** Dotted machine name, e.g. "ticket.reply_public". */
    key: text('key').notNull(),
    /** Coarse grouping for UI (e.g. "ticket", "org", "admin"). */
    category: text('category').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('permissions_key_idx').on(t.key),
    index('permissions_category_idx').on(t.category),
  ]
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: typeIdWithDefault('role_perm')('id').primaryKey(),
    roleId: typeIdColumn('role')('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: typeIdColumn('perm')('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('role_permissions_role_permission_idx').on(t.roleId, t.permissionId),
    index('role_permissions_permission_idx').on(t.permissionId),
  ]
)

/**
 * principal_role_assignments — which roles a principal holds.
 *
 * `team_id` NULL = workspace-wide grant. Non-null = grant only applies to
 * actions whose scope evaluator matches that team.
 */
export const principalRoleAssignments = pgTable(
  'principal_role_assignments',
  {
    id: typeIdWithDefault('role_asgn')('id').primaryKey(),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    roleId: typeIdColumn('role')('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    /** NULL = workspace-wide grant. */
    teamId: typeIdColumnNullable('team')('team_id').references(() => teams.id, {
      onDelete: 'cascade',
    }),
    /** Principal that performed the grant; null = system / migration. */
    grantedByPrincipalId: typeIdColumnNullable('principal')('granted_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Same role can't be granted twice for the same scope.
    uniqueIndex('principal_role_assignments_principal_role_team_idx')
      .on(t.principalId, t.roleId, t.teamId)
      .where(sql`team_id IS NOT NULL`),
    uniqueIndex('principal_role_assignments_principal_role_workspace_idx')
      .on(t.principalId, t.roleId)
      .where(sql`team_id IS NULL`),
    index('principal_role_assignments_principal_idx').on(t.principalId),
    index('principal_role_assignments_team_idx').on(t.teamId),
  ]
)
