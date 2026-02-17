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
import { postExternalLinks } from './external-links'
import { principal } from './auth'
import type { TiptapContent } from '../types'

// Custom tsvector type for full-text search
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

// Custom vector type for embeddings (pgvector)
// 1536 dimensions = OpenAI text-embedding-3-small
const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)'
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
    contentJson: jsonb('content_json').$type<TiptapContent>(),
    // Principal-scoped identity - every post has an author
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'restrict' }),
    // Status reference to post_statuses table
    statusId: typeIdColumn('status')('status_id').references(() => postStatuses.id, {
      onDelete: 'set null',
    }),
    // Owner is also principal-scoped (team member assigned to this post)
    ownerPrincipalId: typeIdColumnNullable('principal')('owner_principal_id').references(
      () => principal.id,
      {
        onDelete: 'set null',
      }
    ),
    voteCount: integer('vote_count').default(0).notNull(),
    // Denormalized comment count for performance
    // Maintained by application code in comment.service.ts (create/delete operations)
    commentCount: integer('comment_count').default(0).notNull(),
    // Pinned comment as official response
    // References a team member's root-level comment that serves as the official response
    pinnedCommentId: typeIdColumnNullable('comment')('pinned_comment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByPrincipalId: typeIdColumnNullable('principal')('deleted_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    // Lock thread: prevent portal users from commenting (team members can still comment)
    isCommentsLocked: boolean('is_comments_locked').default(false).notNull(),
    // Moderation state for imported/pending content
    moderationState: text('moderation_state', {
      enum: ['published', 'pending', 'spam', 'archived', 'closed', 'deleted'],
    })
      .default('published')
      .notNull(),
    // Merge/deduplication: points to the canonical post this was merged into
    canonicalPostId: typeIdColumnNullable('post')('canonical_post_id'),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    mergedByPrincipalId: typeIdColumnNullable('principal')('merged_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    // Full-text search vector (generated column, auto-computed from title and content)
    // Title has weight 'A' (highest), content has weight 'B'
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')`
    ),
    // Semantic embedding for AI-powered similarity search (1536 dims = OpenAI text-embedding-3-small)
    embedding: vector('embedding'),
    // Track model version for future upgrades (allows re-embedding without data loss)
    embeddingModel: text('embedding_model'),
    embeddingUpdatedAt: timestamp('embedding_updated_at', { withTimezone: true }),
  },
  (table) => [
    index('posts_board_id_idx').on(table.boardId),
    index('posts_status_id_idx').on(table.statusId),
    index('posts_principal_id_idx').on(table.principalId),
    index('posts_owner_principal_id_idx').on(table.ownerPrincipalId),
    index('posts_created_at_idx').on(table.createdAt),
    index('posts_vote_count_idx').on(table.voteCount),
    // Composite indexes for post listings sorted by "top" and "new"
    index('posts_board_vote_idx').on(table.boardId, table.voteCount),
    index('posts_board_created_at_idx').on(table.boardId, table.createdAt),
    // Composite index for admin inbox filtering by status
    index('posts_board_status_idx').on(table.boardId, table.statusId),
    // Composite index for user activity pages (posts by author)
    index('posts_principal_created_at_idx').on(table.principalId, table.createdAt),
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
    // Index for moderation state filtering
    index('posts_moderation_state_idx').on(table.moderationState),
    // Index for pinned comment lookups
    index('posts_pinned_comment_id_idx').on(table.pinnedCommentId),
    // Index for finding merged/duplicate posts by canonical post
    index('posts_canonical_post_id_idx').on(table.canonicalPostId),
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
    // principal_id is required - only authenticated users can vote
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('votes_post_id_idx').on(table.postId),
    // Unique constraint: one vote per principal per post
    uniqueIndex('votes_principal_post_idx').on(table.postId, table.principalId),
    index('votes_principal_id_idx').on(table.principalId),
    index('votes_principal_created_at_idx').on(table.principalId, table.createdAt),
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
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    isTeamMember: boolean('is_team_member').default(false).notNull(),
    // Status change tracking: records which status transition occurred with this comment
    statusChangeFromId: typeIdColumnNullable('status')('status_change_from_id').references(
      () => postStatuses.id,
      { onDelete: 'set null' }
    ),
    statusChangeToId: typeIdColumnNullable('status')('status_change_to_id').references(
      () => postStatuses.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('comments_post_id_idx').on(table.postId),
    index('comments_parent_id_idx').on(table.parentId),
    index('comments_principal_id_idx').on(table.principalId),
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
    // principal_id is required - only authenticated users can react
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('comment_reactions_comment_id_idx').on(table.commentId),
    index('comment_reactions_principal_id_idx').on(table.principalId),
    uniqueIndex('comment_reactions_unique_idx').on(table.commentId, table.principalId, table.emoji),
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
    editorPrincipalId: typeIdColumn('principal')('editor_principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'set null' }),
    previousTitle: text('previous_title').notNull(),
    previousContent: text('previous_content').notNull(),
    previousContentJson: jsonb('previous_content_json').$type<TiptapContent>(),
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
    editorPrincipalId: typeIdColumn('principal')('editor_principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'set null' }),
    previousContent: text('previous_content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('comment_edit_history_comment_id_idx').on(table.commentId),
    index('comment_edit_history_created_at_idx').on(table.createdAt),
  ]
)

// Internal staff notes on posts (not visible to public users)
export const postNotes = pgTable(
  'post_notes',
  {
    id: typeIdWithDefault('note')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    // Principal who created the note (staff only)
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('post_notes_post_id_idx').on(table.postId),
    index('post_notes_principal_id_idx').on(table.principalId),
    index('post_notes_created_at_idx').on(table.createdAt),
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
  // Principal-scoped author (Hub-and-Spoke identity)
  author: one(principal, {
    fields: [posts.principalId],
    references: [principal.id],
    relationName: 'postAuthor',
  }),
  // Principal-scoped owner (team member assigned)
  owner: one(principal, {
    fields: [posts.ownerPrincipalId],
    references: [principal.id],
    relationName: 'postOwner',
  }),
  // Pinned comment as official response
  pinnedComment: one(comments, {
    fields: [posts.pinnedCommentId],
    references: [comments.id],
  }),
  // Merge/deduplication: the canonical post this was merged into
  canonicalPost: one(posts, {
    fields: [posts.canonicalPostId],
    references: [posts.id],
    relationName: 'mergedPosts',
  }),
  // Merge/deduplication: posts that have been merged into this one
  mergedPosts: many(posts, { relationName: 'mergedPosts' }),
  // Merge actor
  mergedBy: one(principal, {
    fields: [posts.mergedByPrincipalId],
    references: [principal.id],
    relationName: 'postMergedBy',
  }),
  votes: many(votes),
  comments: many(comments),
  tags: many(postTags),
  roadmaps: many(postRoadmaps),
  notes: many(postNotes),
  externalLinks: many(postExternalLinks),
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
  // Principal-scoped author (Hub-and-Spoke identity)
  author: one(principal, {
    fields: [comments.principalId],
    references: [principal.id],
    relationName: 'commentAuthor',
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: 'commentReplies',
  }),
  replies: many(comments, { relationName: 'commentReplies' }),
  reactions: many(commentReactions),
  // Status change tracking
  statusChangeFrom: one(postStatuses, {
    fields: [comments.statusChangeFromId],
    references: [postStatuses.id],
    relationName: 'commentStatusChangeFrom',
  }),
  statusChangeTo: one(postStatuses, {
    fields: [comments.statusChangeToId],
    references: [postStatuses.id],
    relationName: 'commentStatusChangeTo',
  }),
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
  editor: one(principal, {
    fields: [postEditHistory.editorPrincipalId],
    references: [principal.id],
    relationName: 'postEditHistoryEditor',
  }),
}))

export const commentEditHistoryRelations = relations(commentEditHistory, ({ one }) => ({
  comment: one(comments, {
    fields: [commentEditHistory.commentId],
    references: [comments.id],
  }),
  editor: one(principal, {
    fields: [commentEditHistory.editorPrincipalId],
    references: [principal.id],
    relationName: 'commentEditHistoryEditor',
  }),
}))

// Post notes relations
export const postNotesRelations = relations(postNotes, ({ one }) => ({
  post: one(posts, {
    fields: [postNotes.postId],
    references: [posts.id],
  }),
  author: one(principal, {
    fields: [postNotes.principalId],
    references: [principal.id],
    relationName: 'noteAuthor',
  }),
}))
