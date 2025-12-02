import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { boards, tags, roadmaps } from './boards'
import { appUser } from './rls'

const postsOrgCheck = sql`board_id IN (
  SELECT id FROM boards
  WHERE organization_id = current_setting('app.organization_id', true)
)`

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    authorId: text('author_id'),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    status: text('status', {
      enum: ['open', 'under_review', 'planned', 'in_progress', 'complete', 'closed'],
    }).default('open').notNull(),
    ownerId: text('owner_id'),
    estimated: text('estimated'),
    voteCount: integer('vote_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('posts_board_id_idx').on(table.boardId),
    index('posts_status_idx').on(table.status),
    index('posts_owner_id_idx').on(table.ownerId),
    index('posts_created_at_idx').on(table.createdAt),
    index('posts_vote_count_idx').on(table.voteCount),
    pgPolicy('posts_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: postsOrgCheck,
      withCheck: postsOrgCheck,
    }),
  ]
).enableRLS()

const postRelatedOrgCheck = sql`post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)`

export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('post_tags_pk').on(table.postId, table.tagId),
    index('post_tags_post_id_idx').on(table.postId),
    index('post_tags_tag_id_idx').on(table.tagId),
    pgPolicy('post_tags_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: postRelatedOrgCheck,
      withCheck: postRelatedOrgCheck,
    }),
  ]
).enableRLS()

export const postRoadmaps = pgTable(
  'post_roadmaps',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    roadmapId: uuid('roadmap_id')
      .notNull()
      .references(() => roadmaps.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('post_roadmaps_pk').on(table.postId, table.roadmapId),
    index('post_roadmaps_post_id_idx').on(table.postId),
    index('post_roadmaps_roadmap_id_idx').on(table.roadmapId),
    pgPolicy('post_roadmaps_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: postRelatedOrgCheck,
      withCheck: postRelatedOrgCheck,
    }),
  ]
).enableRLS()

export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userIdentifier: text('user_identifier').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('votes_post_id_idx').on(table.postId),
    uniqueIndex('votes_unique_idx').on(table.postId, table.userIdentifier),
    pgPolicy('votes_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: postRelatedOrgCheck,
      withCheck: postRelatedOrgCheck,
    }),
  ]
).enableRLS()

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    authorId: text('author_id'),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('comments_post_id_idx').on(table.postId),
    index('comments_parent_id_idx').on(table.parentId),
    index('comments_created_at_idx').on(table.createdAt),
    pgPolicy('comments_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: postRelatedOrgCheck,
      withCheck: postRelatedOrgCheck,
    }),
  ]
).enableRLS()

export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const
export type ReactionEmoji = typeof REACTION_EMOJIS[number]

const commentReactionsOrgCheck = sql`comment_id IN (
  SELECT c.id FROM comments c
  JOIN posts p ON c.post_id = p.id
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)`

export const commentReactions = pgTable(
  'comment_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userIdentifier: text('user_identifier').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('comment_reactions_comment_id_idx').on(table.commentId),
    uniqueIndex('comment_reactions_unique_idx').on(
      table.commentId,
      table.userIdentifier,
      table.emoji
    ),
    pgPolicy('comment_reactions_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: commentReactionsOrgCheck,
      withCheck: commentReactionsOrgCheck,
    }),
  ]
).enableRLS()

// Relations
export const postsRelations = relations(posts, ({ one, many }) => ({
  board: one(boards, {
    fields: [posts.boardId],
    references: [boards.id],
  }),
  votes: many(votes),
  comments: many(comments),
  tags: many(postTags),
  roadmaps: many(postRoadmaps),
}))

export const postRoadmapsRelations = relations(postRoadmaps, ({ one }) => ({
  post: one(posts, {
    fields: [postRoadmaps.postId],
    references: [posts.id],
  }),
  roadmap: one(roadmaps, {
    fields: [postRoadmaps.roadmapId],
    references: [roadmaps.id],
  }),
}))

export const votesRelations = relations(votes, ({ one }) => ({
  post: one(posts, {
    fields: [votes.postId],
    references: [posts.id],
  }),
}))

export const commentsRelations = relations(comments, ({ one, many }) => ({
  post: one(posts, {
    fields: [comments.postId],
    references: [posts.id],
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: 'commentReplies',
  }),
  replies: many(comments, { relationName: 'commentReplies' }),
  reactions: many(commentReactions),
}))

export const commentReactionsRelations = relations(commentReactions, ({ one }) => ({
  comment: one(comments, {
    fields: [commentReactions.commentId],
    references: [comments.id],
  }),
}))

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, {
    fields: [postTags.postId],
    references: [posts.id],
  }),
  tag: one(tags, {
    fields: [postTags.tagId],
    references: [tags.id],
  }),
}))
