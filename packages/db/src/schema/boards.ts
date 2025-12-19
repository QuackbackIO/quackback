import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { appUser } from './rls'

export const boards = pgTable(
  'boards',
  {
    id: typeIdWithDefault('board')('id').primaryKey(),
    workspaceId: typeIdColumn('workspace')('workspace_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    settings: jsonb('settings').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('boards_workspace_slug_idx').on(table.workspaceId, table.slug),
    index('boards_workspace_id_idx').on(table.workspaceId),
    pgPolicy('boards_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
    }),
  ]
).enableRLS()

export const roadmaps = pgTable(
  'roadmaps',
  {
    id: typeIdWithDefault('roadmap')('id').primaryKey(),
    workspaceId: typeIdColumn('workspace')('workspace_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('roadmaps_workspace_slug_idx').on(table.workspaceId, table.slug),
    index('roadmaps_workspace_id_idx').on(table.workspaceId),
    index('roadmaps_position_idx').on(table.workspaceId, table.position),
    pgPolicy('roadmaps_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
    }),
  ]
).enableRLS()

export const tags = pgTable(
  'tags',
  {
    id: typeIdWithDefault('tag')('id').primaryKey(),
    workspaceId: typeIdColumn('workspace')('workspace_id').notNull(),
    name: text('name').notNull(),
    color: text('color').default('#6b7280').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tags_workspace_name_idx').on(table.workspaceId, table.name),
    index('tags_workspace_id_idx').on(table.workspaceId),
    pgPolicy('tags_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
    }),
  ]
).enableRLS()

// Relations - defined after posts import to avoid circular dependency
import { posts, postRoadmaps } from './posts'
import { changelogEntries } from './changelog'

export const boardsRelations = relations(boards, ({ many }) => ({
  posts: many(posts),
  changelogEntries: many(changelogEntries),
}))

export const roadmapsRelations = relations(roadmaps, ({ many }) => ({
  postRoadmaps: many(postRoadmaps),
}))

export const tagsRelations = relations(tags, ({ many }) => ({
  postTags: many(postTags),
}))

import { postTags } from './posts'
