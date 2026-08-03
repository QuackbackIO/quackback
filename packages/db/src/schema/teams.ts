/**
 * Teams schema — first-class grouping for principals.
 *
 * Teams are used by the ticketing module to:
 *   - own queues and shared inboxes,
 *   - scope ticket visibility (`team`, `shared`),
 *   - group permission grants (a user can be assigned a role *within* a team).
 *
 * A principal may belong to multiple teams; one of those memberships may be
 * marked `lead` to denote supervisor-style permissions.
 */
import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'

export const teams = pgTable(
  'teams',
  {
    id: typeIdWithDefault('team')('id').primaryKey(),
    /** Stable URL-friendly identifier (lowercase, kebab). */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Optional short label used as a coloured chip in the UI (e.g. "T1", "BIL"). */
    shortLabel: text('short_label'),
    /** Hex colour for UI chips. Optional; UI falls back to a hash of the id. */
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('teams_slug_idx').on(t.slug), index('teams_archived_at_idx').on(t.archivedAt)]
)

/**
 * team_memberships — N:M between principals and teams.
 *
 * `role` is the *team-local* role (`lead` | `member`) and is independent from
 * the global RBAC `roles` table. Use the role-assignments table for permission
 * grants scoped to a team.
 */
export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: typeIdWithDefault('team_member')('id').primaryKey(),
    teamId: typeIdColumn('team')('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['lead', 'member'] })
      .default('member')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('team_memberships_team_principal_idx').on(t.teamId, t.principalId),
    index('team_memberships_principal_idx').on(t.principalId),
  ]
)

export const teamsRelations = relations(teams, ({ many }) => ({
  memberships: many(teamMemberships),
}))

export const teamMembershipsRelations = relations(teamMemberships, ({ one }) => ({
  team: one(teams, {
    fields: [teamMemberships.teamId],
    references: [teams.id],
  }),
  principal: one(principal, {
    fields: [teamMemberships.principalId],
    references: [principal.id],
  }),
}))
