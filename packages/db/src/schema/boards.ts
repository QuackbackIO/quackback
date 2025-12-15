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
import { typeIdWithDefault } from '@quackback/ids/drizzle'
import { appUser } from './rls'

export const boards = pgTable(
  'boards',
  {
    id: typeIdWithDefault('board')('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    settings: jsonb('settings').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('boards_org_slug_idx').on(table.organizationId, table.slug),
    index('boards_org_id_idx').on(table.organizationId),
    pgPolicy('boards_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`organization_id = current_setting('app.organization_id', true)`,
      withCheck: sql`organization_id = current_setting('app.organization_id', true)`,
    }),
  ]
).enableRLS()

export const roadmaps = pgTable(
  'roadmaps',
  {
    id: typeIdWithDefault('roadmap')('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('roadmaps_org_slug_idx').on(table.organizationId, table.slug),
    index('roadmaps_org_id_idx').on(table.organizationId),
    index('roadmaps_position_idx').on(table.organizationId, table.position),
    pgPolicy('roadmaps_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`organization_id = current_setting('app.organization_id', true)`,
      withCheck: sql`organization_id = current_setting('app.organization_id', true)`,
    }),
  ]
).enableRLS()

export const tags = pgTable(
  'tags',
  {
    id: typeIdWithDefault('tag')('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    color: text('color').default('#6b7280').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tags_org_name_idx').on(table.organizationId, table.name),
    index('tags_org_id_idx').on(table.organizationId),
    pgPolicy('tags_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`organization_id = current_setting('app.organization_id', true)`,
      withCheck: sql`organization_id = current_setting('app.organization_id', true)`,
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
