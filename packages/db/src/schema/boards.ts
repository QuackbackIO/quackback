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
import { relations } from 'drizzle-orm'
import { typeIdWithDefault } from '@quackback/ids/drizzle'

export const boards = pgTable(
  'boards',
  {
    id: typeIdWithDefault('board')('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    settings: jsonb('settings').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('boards_slug_idx').on(table.slug)]
)

export const roadmaps = pgTable(
  'roadmaps',
  {
    id: typeIdWithDefault('roadmap')('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('roadmaps_slug_idx').on(table.slug),
    index('roadmaps_position_idx').on(table.position),
  ]
)

export const tags = pgTable(
  'tags',
  {
    id: typeIdWithDefault('tag')('id').primaryKey(),
    name: text('name').notNull().unique(),
    color: text('color').default('#6b7280').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('tags_name_idx').on(table.name)]
)

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
