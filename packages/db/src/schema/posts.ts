import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { boards, tags, roadmaps } from './boards'
import { postStatuses } from './statuses'
import { member } from './auth'
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
    // Rich content stored as TipTap JSON (optional, for rich text support)
    contentJson: jsonb('content_json'),
    // Member-scoped identity (Hub-and-Spoke model)
    // memberId links to the organization-scoped member record
    // For anonymous posts, memberId is null and authorName/authorEmail are used
    memberId: text('member_id').references(() => member.id, { onDelete: 'set null' }),
    // Legacy fields (kept for anonymous posts and migration compatibility)
    authorId: text('author_id'),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    // Legacy status field - kept during migration, will be removed
    status: text('status', {
      enum: ['open', 'under_review', 'planned', 'in_progress', 'complete', 'closed'],
    })
      .default('open')
      .notNull(),
    // New status reference to post_statuses table
    statusId: uuid('status_id').references(() => postStatuses.id, { onDelete: 'set null' }),
    // Owner is also member-scoped (team member assigned to this post)
    ownerMemberId: text('owner_member_id').references(() => member.id, { onDelete: 'set null' }),
    ownerId: text('owner_id'), // Legacy, kept for migration
    estimated: text('estimated'),
    voteCount: integer('vote_count').default(0).notNull(),
    // Official team response (member-scoped)
    officialResponse: text('official_response'),
    officialResponseMemberId: text('official_response_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    officialResponseAuthorId: text('official_response_author_id'), // Legacy
    officialResponseAuthorName: text('official_response_author_name'),
    officialResponseAt: timestamp('official_response_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('posts_board_id_idx').on(table.boardId),
    index('posts_status_idx').on(table.status),
    index('posts_status_id_idx').on(table.statusId),
    index('posts_member_id_idx').on(table.memberId),
    index('posts_owner_member_id_idx').on(table.ownerMemberId),
    index('posts_owner_id_idx').on(table.ownerId), // Legacy index
    index('posts_created_at_idx').on(table.createdAt),
    index('posts_vote_count_idx').on(table.voteCount),
    // Composite indexes for public post listings sorted by "top" and "new"
    index('posts_board_vote_count_idx').on(table.boardId, table.voteCount),
    index('posts_board_created_at_idx').on(table.boardId, table.createdAt),
    // Composite index for admin inbox filtering by status
    index('posts_board_status_idx').on(table.boardId, table.status),
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
    statusId: uuid('status_id').references(() => postStatuses.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    uniqueIndex('post_roadmaps_pk').on(table.postId, table.roadmapId),
    index('post_roadmaps_post_id_idx').on(table.postId),
    index('post_roadmaps_roadmap_id_idx').on(table.roadmapId),
    index('post_roadmaps_position_idx').on(table.roadmapId, table.statusId, table.position),
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
    // Member reference for FK integrity (nullable for anonymous votes)
    memberId: text('member_id').references(() => member.id, { onDelete: 'cascade' }),
    // Hashed IP for abuse detection (privacy-preserving)
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Track when vote was last toggled
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('votes_post_id_idx').on(table.postId),
    uniqueIndex('votes_unique_idx').on(table.postId, table.userIdentifier),
    index('votes_member_id_idx').on(table.memberId),
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
    // Member-scoped identity (Hub-and-Spoke model)
    // memberId links to the organization-scoped member record
    // For anonymous comments, memberId is null and authorName/authorEmail are used
    memberId: text('member_id').references(() => member.id, { onDelete: 'set null' }),
    // Legacy fields (kept for anonymous comments and migration compatibility)
    authorId: text('author_id'),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    content: text('content').notNull(),
    isTeamMember: boolean('is_team_member').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('comments_post_id_idx').on(table.postId),
    index('comments_parent_id_idx').on(table.parentId),
    index('comments_member_id_idx').on(table.memberId),
    index('comments_created_at_idx').on(table.createdAt),
    // Composite index for comment threads ordered chronologically
    index('comments_post_created_at_idx').on(table.postId, table.createdAt),
    pgPolicy('comments_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: postRelatedOrgCheck,
      withCheck: postRelatedOrgCheck,
    }),
  ]
).enableRLS()

// REACTION_EMOJIS and ReactionEmoji are exported from types.ts

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
  // Status reference (new customizable status system)
  postStatus: one(postStatuses, {
    fields: [posts.statusId],
    references: [postStatuses.id],
  }),
  // Member-scoped author (Hub-and-Spoke identity)
  author: one(member, {
    fields: [posts.memberId],
    references: [member.id],
    relationName: 'postAuthor',
  }),
  // Member-scoped owner (team member assigned)
  owner: one(member, {
    fields: [posts.ownerMemberId],
    references: [member.id],
    relationName: 'postOwner',
  }),
  // Member-scoped official response author
  officialResponseAuthor: one(member, {
    fields: [posts.officialResponseMemberId],
    references: [member.id],
    relationName: 'postOfficialResponseAuthor',
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
  status: one(postStatuses, {
    fields: [postRoadmaps.statusId],
    references: [postStatuses.id],
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
  // Member-scoped author (Hub-and-Spoke identity)
  author: one(member, {
    fields: [comments.memberId],
    references: [member.id],
    relationName: 'commentAuthor',
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

// Post statuses relations (defined here to avoid circular dependency with statuses.ts)
export const postStatusesRelations = relations(postStatuses, ({ many }) => ({
  posts: many(posts),
}))
