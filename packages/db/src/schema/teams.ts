/**
 * Teams — assignable groups of teammates for the support inbox (support
 * platform §4.12). Membership is a pure relationship, separate from role; the
 * conversation assignee is polymorphic (a team OR a teammate, two independent
 * nullable columns with no clearing rule).
 *
 * A workspace seeds one `is_default` team ("Support"); the app enforces at most
 * one default (there is no DB unique constraint, so a workspace may briefly
 * have zero while the default is being switched). `deleted_at` is a soft delete
 * so a removed team's set-null'd assignment history survives.
 *
 * `assignment_method` drives distribution when a conversation is assigned to
 * the team: `manual` assigns the team only, `round_robin` rotates over online
 * members (cursor persisted on `rr_cursor_principal_id`), `balanced` reuses the
 * least-loaded auto-assign strategy scoped to the team's members.
 */
import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { TEAM_ASSIGNMENT_METHODS } from '../types'

export const teams = pgTable(
  'teams',
  {
    id: typeIdWithDefault('team')('id').primaryKey(),
    name: text('name').notNull(),
    // Inbox-only display; never shown to customers.
    icon: text('icon'),
    color: text('color'),
    description: text('description'),
    // App enforces at most one default (no DB unique constraint).
    isDefault: boolean('is_default').notNull().default(false),
    // How a team-assigned conversation picks a member. Kept in sync with
    // TEAM_ASSIGNMENT_METHODS; 'manual' assigns the team only.
    assignmentMethod: text('assignment_method', { enum: TEAM_ASSIGNMENT_METHODS })
      .notNull()
      .default('manual'),
    // Round-robin rotation cursor: the member assigned last. Set null if that
    // member is deleted; the rotation simply restarts from the top.
    rrCursorPrincipalId: typeIdColumnNullable('principal')('rr_cursor_principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // Soft delete; set-null'd assignment history on conversations survives.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'teams_rr_cursor_principal_id_fkey',
      columns: [table.rrCursorPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    // The default team lookup skips soft-deleted rows.
    index('teams_is_default_idx')
      .on(table.id)
      .where(sql`is_default = true AND deleted_at IS NULL`),
  ]
)

export const teamMembers = pgTable(
  'team_members',
  {
    id: typeIdWithDefault('team_member')('id').primaryKey(),
    teamId: typeIdColumn('team')('team_id').notNull(),
    principalId: typeIdColumn('principal')('principal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'team_members_team_id_fkey',
      columns: [table.teamId],
      foreignColumns: [teams.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'team_members_principal_id_fkey',
      columns: [table.principalId],
      foreignColumns: [principal.id],
    }).onDelete('cascade'),
    // One membership per (team, principal). Declared in alphabetical column
    // order to match how drizzle-kit introspects the live index.
    uniqueIndex('team_members_principal_team_uq').on(table.principalId, table.teamId),
    // Members-of-team roster lookups.
    index('team_members_team_idx').on(table.teamId),
  ]
)

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
}))

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  principal: one(principal, {
    fields: [teamMembers.principalId],
    references: [principal.id],
  }),
}))
