/**
 * Workspace Labs experiments.
 *
 * One row per workspace and registered experiment. Missing rows mean both
 * `visible` and `enabled` are false. Visibility controls Labs discoverability;
 * enabled controls runtime behavior. Hiding an enabled experiment does not
 * disable it.
 */
import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdColumn } from '@quackback/ids/drizzle'
import { settings } from './auth'

export const workspaceExperiments = pgTable(
  'workspace_experiments',
  {
    settingsId: typeIdColumn('workspace')('settings_id')
      .notNull()
      .references(() => settings.id, { onDelete: 'cascade' }),
    experimentId: text('experiment_id').notNull(),
    visible: boolean('visible').notNull().default(false),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: 'workspace_experiments_pkey',
      columns: [table.settingsId, table.experimentId],
    }),
  ]
)

export const workspaceExperimentsRelations = relations(workspaceExperiments, ({ one }) => ({
  settings: one(settings, {
    fields: [workspaceExperiments.settingsId],
    references: [settings.id],
  }),
}))
