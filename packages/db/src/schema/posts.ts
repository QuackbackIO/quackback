import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { boards, tags, roadmaps } from './boards'
import { postStatuses } from './statuses'
import { member, organization } from './auth'
import { appUser } from './rls'

// Custom tsvector type for full-text search
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

// Simplified RLS check - direct organization_id column comparison
const directOrgCheck = sql`organization_id = current_setting('app.organization_id', true)::uuid`

export const posts = pgTable(
  'posts',
  {
    id: typeIdWithDefault('post')('id').primaryKey(),
    // Denormalized for RLS performance - avoids join to boards table
    organizationId: typeIdColumn('org')('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    boardId: typeIdColumn('board')('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    // Rich content stored as TipTap JSON (optional, for rich text support)
    contentJson: jsonb('content_json'),
    // Member-scoped identity (Hub-and-Spoke model)
    // memberId links to the organization-scoped member record
    // For anonymous posts, memberId is null and authorName/authorEmail are used
    memberId: typeIdColumnNullable('member')('member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    // Legacy fields (kept for anonymous posts and migration compatibility)
    authorId: text('author_id'),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    // Status reference to post_statuses table
    statusId: typeIdColumn('status')('status_id').references(() => postStatuses.id, {
      onDelete: 'set null',
    }),
    // Owner is also member-scoped (team member assigned to this post)
    ownerMemberId: typeIdColumnNullable('member')('owner_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    ownerId: text('owner_id'), // Legacy, kept for migration
    estimated: text('estimated'),
    voteCount: integer('vote_count').default(0).notNull(),
    // Official team response (member-scoped)
    officialResponse: text('official_response'),
    officialResponseMemberId: typeIdColumnNullable('member')(
      'official_response_member_id'
    ).references(() => member.id, {
      onDelete: 'set null',
    }),
    officialResponseAuthorId: text('official_response_author_id'), // Legacy
    officialResponseAuthorName: text('official_response_author_name'),
    officialResponseAt: timestamp('official_response_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Full-text search vector (generated column, auto-computed from title and content)
    // Title has weight 'A' (highest), content has weight 'B'
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')`
    ),
  },
  (table) => [
    // Organization index for RLS performance
    index('posts_org_id_idx').on(table.organizationId),
    index('posts_board_id_idx').on(table.boardId),
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
    index('posts_board_status_id_idx').on(table.boardId, table.statusId),
    // Composite index for user activity pages (posts by author)
    index('posts_member_created_at_idx').on(table.memberId, table.createdAt),
    // Composite index for org-scoped post listings (replaces board-based RLS lookups)
    index('posts_org_board_vote_created_idx').on(
      table.organizationId,
      table.boardId,
      table.voteCount
    ),
    // Partial index for roadmap posts (only posts with status)
    index('posts_with_status_idx')
      .on(table.statusId, table.voteCount)
      .where(sql`status_id IS NOT NULL`),
    // GIN index for full-text search
    index('posts_search_vector_idx').using('gin', table.searchVector),
    pgPolicy('posts_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: directOrgCheck,
      withCheck: directOrgCheck,
    }),
  ]
).enableRLS()

// RLS check via posts table (single join to posts.organization_id)
const postTagsOrgCheck = sql`post_id IN (
  SELECT id FROM posts WHERE organization_id = current_setting('app.organization_id', true)::uuid
)`

export const postTags = pgTable(
  'post_tags',
  {
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: typeIdColumn('tag')('tag_id')
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
      using: postTagsOrgCheck,
      withCheck: postTagsOrgCheck,
    }),
  ]
).enableRLS()

export const postRoadmaps = pgTable(
  'post_roadmaps',
  {
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    roadmapId: typeIdColumn('roadmap')('roadmap_id')
      .notNull()
      .references(() => roadmaps.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    uniqueIndex('post_roadmaps_pk').on(table.postId, table.roadmapId),
    index('post_roadmaps_post_id_idx').on(table.postId),
    index('post_roadmaps_roadmap_id_idx').on(table.roadmapId),
    index('post_roadmaps_position_idx').on(table.roadmapId, table.position),
    pgPolicy('post_roadmaps_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: postTagsOrgCheck,
      withCheck: postTagsOrgCheck,
    }),
  ]
).enableRLS()

export const votes = pgTable(
  'votes',
  {
    id: typeIdWithDefault('vote')('id').primaryKey(),
    // Denormalized for RLS performance
    organizationId: typeIdColumn('org')('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userIdentifier: text('user_identifier').notNull(),
    memberId: typeIdColumnNullable('member')('member_id').references(() => member.id, {
      onDelete: 'cascade',
    }),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('votes_org_id_idx').on(table.organizationId),
    index('votes_post_id_idx').on(table.postId),
    uniqueIndex('votes_unique_idx').on(table.postId, table.userIdentifier),
    index('votes_member_id_idx').on(table.memberId),
    index('votes_member_created_at_idx').on(table.memberId, table.createdAt),
    pgPolicy('votes_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: directOrgCheck,
      withCheck: directOrgCheck,
    }),
  ]
).enableRLS()

export const comments = pgTable(
  'comments',
  {
    id: typeIdWithDefault('comment')('id').primaryKey(),
    // Denormalized for RLS performance
    organizationId: typeIdColumn('org')('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parentId: typeIdColumn('comment')('parent_id'),
    memberId: typeIdColumnNullable('member')('member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    authorId: text('author_id'),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    content: text('content').notNull(),
    isTeamMember: boolean('is_team_member').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('comments_org_id_idx').on(table.organizationId),
    index('comments_post_id_idx').on(table.postId),
    index('comments_parent_id_idx').on(table.parentId),
    index('comments_member_id_idx').on(table.memberId),
    index('comments_created_at_idx').on(table.createdAt),
    index('comments_post_created_at_idx').on(table.postId, table.createdAt),
    pgPolicy('comments_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: directOrgCheck,
      withCheck: directOrgCheck,
    }),
  ]
).enableRLS()

// RLS check via comments table (single join to comments.organization_id)
const commentReactionsOrgCheck = sql`comment_id IN (
  SELECT id FROM comments WHERE organization_id = current_setting('app.organization_id', true)::uuid
)`

export const commentReactions = pgTable(
  'comment_reactions',
  {
    id: typeIdWithDefault('reaction')('id').primaryKey(),
    commentId: typeIdColumn('comment')('comment_id')
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
