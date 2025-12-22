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
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { boards, tags, roadmaps } from './boards'
import { postStatuses } from './statuses'
import { member } from './auth'

// Custom tsvector type for full-text search
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const posts = pgTable(
  'posts',
  {
    id: typeIdWithDefault('post')('id').primaryKey(),
    boardId: typeIdColumn('board')('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    // Rich content stored as TipTap JSON (optional, for rich text support)
    contentJson: jsonb('content_json'),
    // Member-scoped identity (Hub-and-Spoke model)
    // memberId links to the workspace-scoped member record
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
    // Denormalized comment count for performance (updated via trigger)
    commentCount: integer('comment_count').default(0).notNull(),
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
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByMemberId: typeIdColumnNullable('member')('deleted_by_member_id').references(
      () => member.id,
      { onDelete: 'set null' }
    ),
    // Full-text search vector (generated column, auto-computed from title and content)
    // Title has weight 'A' (highest), content has weight 'B'
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')`
    ),
  },
  (table) => [
    index('posts_board_id_idx').on(table.boardId),
    index('posts_status_id_idx').on(table.statusId),
    index('posts_member_id_idx').on(table.memberId),
    index('posts_owner_member_id_idx').on(table.ownerMemberId),
    index('posts_owner_id_idx').on(table.ownerId), // Legacy index
    index('posts_created_at_idx').on(table.createdAt),
    index('posts_vote_count_idx').on(table.voteCount),
    // Composite indexes for post listings sorted by "top" and "new"
    index('posts_board_vote_idx').on(table.boardId, table.voteCount),
    index('posts_board_created_at_idx').on(table.boardId, table.createdAt),
    // Composite index for admin inbox filtering by status
    index('posts_board_status_idx').on(table.boardId, table.statusId),
    // Composite index for user activity pages (posts by author)
    index('posts_member_created_at_idx').on(table.memberId, table.createdAt),
    // Partial index for roadmap posts (only posts with status)
    index('posts_with_status_idx')
      .on(table.statusId, table.voteCount)
      .where(sql`status_id IS NOT NULL`),
    // GIN index for full-text search
    index('posts_search_vector_idx').using('gin', table.searchVector),
    // Index for filtering deleted posts
    index('posts_deleted_at_idx').on(table.deletedAt),
    // Composite index for soft-delete queries (e.g., active posts by board)
    index('posts_board_deleted_at_idx').on(table.boardId, table.deletedAt),
    // CHECK constraints to ensure counts are never negative
    check('vote_count_non_negative', sql`vote_count >= 0`),
    check('comment_count_non_negative', sql`comment_count >= 0`),
  ]
)

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
  ]
)

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
  ]
)

export const votes = pgTable(
  'votes',
  {
    id: typeIdWithDefault('vote')('id').primaryKey(),
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
    index('votes_post_id_idx').on(table.postId),
    // Unique constraint: one vote per user per post
    uniqueIndex('votes_unique_idx').on(table.postId, table.userIdentifier),
    index('votes_member_id_idx').on(table.memberId),
    index('votes_member_created_at_idx').on(table.memberId, table.createdAt),
  ]
)

export const comments = pgTable(
  'comments',
  {
    id: typeIdWithDefault('comment')('id').primaryKey(),
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
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('comments_post_id_idx').on(table.postId),
    index('comments_parent_id_idx').on(table.parentId),
    index('comments_member_id_idx').on(table.memberId),
    index('comments_created_at_idx').on(table.createdAt),
    // Composite index for comment listings
    index('comments_post_created_at_idx').on(table.postId, table.createdAt),
  ]
)

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
  ]
)

// Edit history tables for tracking post and comment changes
export const postEditHistory = pgTable(
  'post_edit_history',
  {
    id: typeIdWithDefault('post_edit')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    editorMemberId: typeIdColumn('member')('editor_member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'set null' }),
    previousTitle: text('previous_title').notNull(),
    previousContent: text('previous_content').notNull(),
    previousContentJson: jsonb('previous_content_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('post_edit_history_post_id_idx').on(table.postId),
    index('post_edit_history_created_at_idx').on(table.createdAt),
  ]
)

export const commentEditHistory = pgTable(
  'comment_edit_history',
  {
    id: typeIdWithDefault('comment_edit')('id').primaryKey(),
    commentId: typeIdColumn('comment')('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    editorMemberId: typeIdColumn('member')('editor_member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'set null' }),
    previousContent: text('previous_content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('comment_edit_history_comment_id_idx').on(table.commentId),
    index('comment_edit_history_created_at_idx').on(table.createdAt),
  ]
)

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

// Edit history relations
export const postEditHistoryRelations = relations(postEditHistory, ({ one }) => ({
  post: one(posts, {
    fields: [postEditHistory.postId],
    references: [posts.id],
  }),
  editor: one(member, {
    fields: [postEditHistory.editorMemberId],
    references: [member.id],
    relationName: 'postEditHistoryEditor',
  }),
}))

export const commentEditHistoryRelations = relations(commentEditHistory, ({ one }) => ({
  comment: one(comments, {
    fields: [commentEditHistory.commentId],
    references: [comments.id],
  }),
  editor: one(member, {
    fields: [commentEditHistory.editorMemberId],
    references: [member.id],
    relationName: 'commentEditHistoryEditor',
  }),
}))
