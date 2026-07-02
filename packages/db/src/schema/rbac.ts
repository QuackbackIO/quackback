import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

/**
 * RBAC schema — four small tables rooted on the existing `principal`.
 *
 * The permission CATALOGUE is code-authoritative (see ../rbac-catalogue.ts);
 * the `permissions` rows are seeded from it for UI joins and `category`
 * grouping. `principal.role` is retained as a denormalised cache of the
 * primary role so the legacy role gate keeps working through Phase C.
 *
 * `team_id` is reserved for the later team-scoping phase: a plain nullable
 * uuid (no `teams` table yet, always NULL in v1). The partial unique index
 * `(principal_id, role_id) WHERE team_id IS NULL` enforces one workspace-wide
 * assignment per (principal, role) and is the backstop the backfill relies on.
 */

export const roles = pgTable('roles', {
  id: typeIdWithDefault('role')('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const permissions = pgTable('permissions', {
  id: typeIdWithDefault('perm')('id').primaryKey(),
  key: text('key').notNull().unique(),
  category: text('category').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

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
  },
  (table) => [uniqueIndex('role_permissions_unique_idx').on(table.roleId, table.permissionId)]
)

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
    // Reserved for the later team-scoping phase; NULL = workspace-wide.
    teamId: uuid('team_id'),
    grantedByPrincipalId: typeIdColumnNullable('principal')('granted_by_principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Named to match the migration's constraint (63-char pg truncation).
    foreignKey({
      name: 'principal_role_assignments_granted_by_principal_id_principal_id',
      columns: [table.grantedByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    // One workspace-wide assignment per (principal, role). Partial so future
    // team-scoped grants (team_id NOT NULL) are exempt.
    uniqueIndex('principal_role_assignments_workspace_unique_idx')
      .on(table.principalId, table.roleId)
      .where(sql`${table.teamId} IS NULL`),
    index('principal_role_assignments_principal_idx').on(table.principalId),
    index('principal_role_assignments_role_idx').on(table.roleId),
  ]
)
