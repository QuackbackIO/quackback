/**
 * Core data importer
 *
 * Imports validated intermediate format data into the Quackback database.
 * Handles reference resolution, batch processing, and vote count reconciliation.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import { generateId } from '@quackback/ids'
import type { PostId, BoardId, StatusId, TagId, RoadmapId } from '@quackback/ids'

import {
  boards,
  tags,
  roadmaps,
  postStatuses,
  posts,
  postTags,
  postRoadmaps,
  votes,
  comments,
  postNotes,
} from '@quackback/db/schema'
import * as schema from '@quackback/db/schema'

import type {
  IntermediateData,
  IntermediatePost,
  IntermediateComment,
  IntermediateVote,
  IntermediateNote,
  ImportOptions,
  ImportResult,
  ImportError,
} from '../schema/types'
import { ImportIdMaps } from './id-map'
import { UserResolver } from './user-resolver'
import { Progress } from './progress'

type Database = PostgresJsDatabase<typeof schema>

type AnyTable =
  | typeof posts
  | typeof comments
  | typeof votes
  | typeof postNotes
  | typeof tags
  | typeof postTags
  | typeof postRoadmaps

interface ResolvedReferences {
  board: { id: BoardId; slug: string }
  statuses: Map<string, StatusId>
  tags: Map<string, TagId>
  roadmaps: Map<string, RoadmapId>
}

/**
 * Main importer class
 */
export class Importer {
  private db: Database
  private sql: postgres.Sql
  private idMaps = new ImportIdMaps()
  private userResolver: UserResolver = null as unknown as UserResolver
  private progress: Progress
  private refs: ResolvedReferences | null = null
  private errors: ImportError[] = []

  constructor(
    connectionString: string,
    private options: ImportOptions
  ) {
    this.sql = postgres(connectionString, { max: 5 })
    this.db = drizzle(this.sql, { schema })
    this.progress = new Progress(options.verbose ?? false)
  }

  /**
   * Import all data from intermediate format
   */
  async import(data: IntermediateData): Promise<ImportResult> {
    const startTime = Date.now()

    const result: ImportResult = {
      posts: { imported: 0, skipped: 0, errors: 0 },
      comments: { imported: 0, skipped: 0, errors: 0 },
      votes: { imported: 0, skipped: 0, errors: 0 },
      notes: { imported: 0, skipped: 0, errors: 0 },
      duration: 0,
      errors: [],
    }

    try {
      // Step 1: Resolve references
      this.progress.start('Resolving references')
      await this.resolveReferences()
      this.progress.success('References resolved')

      // Step 2: Import posts
      if (data.posts.length > 0) {
        this.progress.start(`Importing ${data.posts.length} posts`)
        result.posts = await this.importPosts(data.posts)
        this.progress.success(`Posts imported`)
      }

      // Step 3: Import comments
      if (data.comments.length > 0) {
        this.progress.start(`Importing ${data.comments.length} comments`)
        result.comments = await this.importComments(data.comments)
        this.progress.success(`Comments imported`)
      }

      // Step 4: Import votes
      if (data.votes.length > 0) {
        this.progress.start(`Importing ${data.votes.length} votes`)
        result.votes = await this.importVotes(data.votes)
        this.progress.success(`Votes imported`)
      }

      // Step 5: Import notes
      if (data.notes.length > 0) {
        this.progress.start(`Importing ${data.notes.length} notes`)
        result.notes = await this.importNotes(data.notes)
        this.progress.success(`Notes imported`)
      }

      // Step 6: Flush pending user creates
      if (this.userResolver?.pendingCount > 0 && !this.options.dryRun) {
        this.progress.start('Creating new users')
        const created = await this.userResolver.flushPendingCreates()
        this.progress.success(`${created} users created`)
      }

      // Step 7: Reconcile vote counts
      if (!this.options.dryRun && result.votes.imported > 0) {
        this.progress.start('Reconciling vote counts')
        await this.reconcileVoteCounts()
        this.progress.success('Vote counts reconciled')
      }

      // Step 8: Update comment counts
      if (!this.options.dryRun && result.comments.imported > 0) {
        this.progress.start('Updating comment counts')
        await this.updateCommentCounts()
        this.progress.success('Comment counts updated')
      }
    } catch (error) {
      this.progress.error(
        `Import failed: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    } finally {
      result.duration = Date.now() - startTime
      result.errors = this.errors
      this.progress.summary(result)
    }

    return result
  }

  /**
   * Resolve board, statuses, tags, and roadmaps from database
   */
  private async resolveReferences(): Promise<void> {
    // Resolve board
    const boardResult = await this.db
      .select({ id: boards.id, slug: boards.slug })
      .from(boards)
      .where(eq(boards.slug, this.options.board))
      .limit(1)

    if (boardResult.length === 0) {
      throw new Error(`Board not found: ${this.options.board}`)
    }

    const board = { id: boardResult[0].id as BoardId, slug: boardResult[0].slug }

    // Resolve statuses
    const statusResults = await this.db
      .select({ id: postStatuses.id, slug: postStatuses.slug })
      .from(postStatuses)

    const statuses = new Map<string, StatusId>()
    for (const s of statusResults) {
      statuses.set(s.slug, s.id as StatusId)
    }

    // Resolve tags
    const tagResults = await this.db.select({ id: tags.id, name: tags.name }).from(tags)

    const tagMap = new Map<string, TagId>()
    for (const t of tagResults) {
      // Normalize tag name for lookup (lowercase, trimmed)
      tagMap.set(t.name.toLowerCase().trim(), t.id as TagId)
    }

    // Resolve roadmaps
    const roadmapResults = await this.db
      .select({ id: roadmaps.id, slug: roadmaps.slug })
      .from(roadmaps)

    const roadmapMap = new Map<string, RoadmapId>()
    for (const r of roadmapResults) {
      roadmapMap.set(r.slug, r.id as RoadmapId)
    }

    this.refs = { board, statuses, tags: tagMap, roadmaps: roadmapMap }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Database type variance between drizzle versions
    this.userResolver = new UserResolver(this.db as any, {
      createUsers: this.options.createUsers ?? false,
    })

    this.progress.step(`Board: ${board.slug}`)
    this.progress.step(`Statuses: ${statuses.size}`)
    this.progress.step(`Tags: ${tagMap.size}`)
    this.progress.step(`Roadmaps: ${roadmapMap.size}`)
  }

  /**
   * Import posts
   */
  private async importPosts(
    postData: IntermediatePost[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const stats = { imported: 0, skipped: 0, errors: 0 }
    if (!this.refs) throw new Error('References not resolved')

    const postInserts: (typeof posts.$inferInsert)[] = []
    const postTagInserts: (typeof postTags.$inferInsert)[] = []
    const postRoadmapInserts: (typeof postRoadmaps.$inferInsert)[] = []
    const newTags: Array<{ id: TagId; name: string }> = []

    // Process posts
    for (let i = 0; i < postData.length; i++) {
      const post = postData[i]

      try {
        const postId = generateId('post')
        this.idMaps.posts.set(post.id, postId)

        // Resolve status
        let statusId: StatusId | null = null
        if (post.status) {
          statusId = this.refs.statuses.get(post.status) ?? null
          if (!statusId && this.options.verbose) {
            this.progress.warn(`Unknown status: ${post.status}`)
          }
        }

        // Resolve member
        const memberId = post.authorEmail
          ? await this.userResolver.resolve(post.authorEmail, post.authorName)
          : null

        // Resolve official response author
        const responseMemberId = post.responseBy
          ? await this.userResolver.resolve(post.responseBy)
          : null

        // Parse date
        const createdAt = post.createdAt ? new Date(post.createdAt) : new Date()
        const responseAt = post.responseAt ? new Date(post.responseAt) : null

        postInserts.push({
          id: postId,
          boardId: this.refs.board.id,
          title: post.title,
          content: post.body,
          memberId,
          authorName: post.authorName,
          authorEmail: post.authorEmail,
          statusId,
          voteCount: post.voteCount ?? 0,
          moderationState: post.moderation ?? 'published',
          officialResponse: post.response,
          officialResponseMemberId: responseMemberId,
          officialResponseAt: responseAt,
          createdAt,
          updatedAt: new Date(),
        })

        // Handle tags
        if (post.tags) {
          const tagNames = post.tags.split(',').map((t) => t.trim().toLowerCase())
          for (const tagName of tagNames) {
            if (!tagName) continue

            let tagId = this.refs.tags.get(tagName)

            // Create tag if it doesn't exist and createTags is enabled
            if (!tagId && (this.options.createTags ?? true)) {
              tagId = generateId('tag')
              this.refs.tags.set(tagName, tagId)
              newTags.push({ id: tagId, name: tagName })
            }

            if (tagId) {
              postTagInserts.push({ postId, tagId })
            }
          }
        }

        // Handle roadmap
        if (post.roadmap) {
          const roadmapId = this.refs.roadmaps.get(post.roadmap)
          if (roadmapId) {
            postRoadmapInserts.push({ postId, roadmapId, position: 0 })
          } else if (this.options.verbose) {
            this.progress.warn(`Unknown roadmap: ${post.roadmap}`)
          }
        }

        stats.imported++
      } catch (error) {
        stats.errors++
        this.errors.push({
          type: 'post',
          externalId: post.id,
          message: error instanceof Error ? error.message : String(error),
          row: i + 2,
        })
      }
    }

    if (this.options.dryRun) {
      this.progress.info(`[DRY RUN] Would insert ${postInserts.length} posts`)
      this.progress.info(`[DRY RUN] Would insert ${postTagInserts.length} post-tag relations`)
      this.progress.info(
        `[DRY RUN] Would insert ${postRoadmapInserts.length} post-roadmap relations`
      )
      if (newTags.length > 0) {
        this.progress.info(`[DRY RUN] Would create ${newTags.length} new tags`)
      }
      return stats
    }

    // Insert new tags first
    if (newTags.length > 0) {
      await this.batchInsert(
        tags,
        newTags.map((t) => ({ id: t.id, name: t.name })),
        'Tags',
        'ignore'
      )
      this.progress.step(`Created ${newTags.length} new tags`)
    }

    // Insert posts and relations
    await this.batchInsert(posts, postInserts, 'Posts')
    await this.batchInsert(postTags, postTagInserts, 'Post-Tags', 'ignore')
    await this.batchInsert(postRoadmaps, postRoadmapInserts, 'Post-Roadmaps', 'ignore')

    return stats
  }

  /**
   * Import comments
   */
  private async importComments(
    commentData: IntermediateComment[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const stats = { imported: 0, skipped: 0, errors: 0 }
    const commentInserts: (typeof comments.$inferInsert)[] = []

    for (let i = 0; i < commentData.length; i++) {
      const comment = commentData[i]

      const postId = this.idMaps.posts.get(comment.postId)
      if (!postId) {
        stats.skipped++
        if (this.options.verbose) {
          this.progress.warn(`Skipping comment: post not found (${comment.postId})`)
        }
        continue
      }

      try {
        const memberId = comment.authorEmail
          ? await this.userResolver.resolve(comment.authorEmail, comment.authorName)
          : null

        commentInserts.push({
          id: generateId('comment'),
          postId,
          memberId,
          authorName: comment.authorName,
          authorEmail: comment.authorEmail,
          content: comment.body,
          isTeamMember: comment.isStaff ?? false,
          createdAt: comment.createdAt ? new Date(comment.createdAt) : new Date(),
        })

        stats.imported++
      } catch (error) {
        stats.errors++
        this.errors.push({
          type: 'comment',
          externalId: comment.postId,
          message: error instanceof Error ? error.message : String(error),
          row: i + 2,
        })
      }
    }

    if (this.options.dryRun) {
      this.progress.info(`[DRY RUN] Would insert ${commentInserts.length} comments`)
      return stats
    }

    await this.batchInsert(comments, commentInserts, 'Comments')
    return stats
  }

  /**
   * Import votes
   */
  private async importVotes(
    voteData: IntermediateVote[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const stats = { imported: 0, skipped: 0, errors: 0 }
    const voteInserts: (typeof votes.$inferInsert)[] = []
    const seenVotes = new Set<string>()

    for (let i = 0; i < voteData.length; i++) {
      const vote = voteData[i]

      const postId = this.idMaps.posts.get(vote.postId)
      if (!postId) {
        stats.skipped++
        continue
      }

      const voteKey = `${postId}:${vote.voterEmail.toLowerCase()}`
      if (seenVotes.has(voteKey)) {
        stats.skipped++
        continue
      }
      seenVotes.add(voteKey)

      try {
        const memberId = await this.userResolver.resolve(vote.voterEmail)

        voteInserts.push({
          postId,
          userIdentifier: `email:${vote.voterEmail.toLowerCase()}`,
          memberId,
          createdAt: vote.createdAt ? new Date(vote.createdAt) : new Date(),
          updatedAt: new Date(),
        })

        stats.imported++
      } catch (error) {
        stats.errors++
        this.errors.push({
          type: 'vote',
          externalId: vote.postId,
          message: error instanceof Error ? error.message : String(error),
          row: i + 2,
        })
      }
    }

    if (this.options.dryRun) {
      this.progress.info(`[DRY RUN] Would insert ${voteInserts.length} votes`)
      return stats
    }

    await this.batchInsert(votes, voteInserts, 'Votes', 'ignore')
    return stats
  }

  /**
   * Import internal notes
   */
  private async importNotes(
    noteData: IntermediateNote[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const stats = { imported: 0, skipped: 0, errors: 0 }
    const noteInserts: (typeof postNotes.$inferInsert)[] = []

    for (let i = 0; i < noteData.length; i++) {
      const note = noteData[i]

      const postId = this.idMaps.posts.get(note.postId)
      if (!postId) {
        stats.skipped++
        if (this.options.verbose) {
          this.progress.warn(`Skipping note: post not found (${note.postId})`)
        }
        continue
      }

      try {
        const memberId = note.authorEmail
          ? await this.userResolver.resolve(note.authorEmail, note.authorName)
          : null

        noteInserts.push({
          id: generateId('note'),
          postId,
          memberId,
          authorName: note.authorName,
          authorEmail: note.authorEmail,
          content: note.body,
          createdAt: note.createdAt ? new Date(note.createdAt) : new Date(),
        })

        stats.imported++
      } catch (error) {
        stats.errors++
        this.errors.push({
          type: 'note',
          externalId: note.postId,
          message: error instanceof Error ? error.message : String(error),
          row: i + 2,
        })
      }
    }

    if (this.options.dryRun) {
      this.progress.info(`[DRY RUN] Would insert ${noteInserts.length} notes`)
      return stats
    }

    await this.batchInsert(postNotes, noteInserts, 'Notes')
    return stats
  }

  private getImportedPostIds(): PostId[] {
    return Array.from(this.idMaps.posts.entries()).map(([, id]) => id)
  }

  private async reconcileVoteCounts(): Promise<void> {
    const postIds = this.getImportedPostIds()
    if (postIds.length === 0) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Raw SQL execution requires flexible typing
    await (this.db as any).execute(sql`
      UPDATE posts
      SET vote_count = (
        SELECT COUNT(*) FROM votes WHERE votes.post_id = posts.id
      )
      WHERE id = ANY(${postIds})
    `)
  }

  private async updateCommentCounts(): Promise<void> {
    const postIds = this.getImportedPostIds()
    if (postIds.length === 0) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Raw SQL execution requires flexible typing
    await (this.db as any).execute(sql`
      UPDATE posts
      SET comment_count = (
        SELECT COUNT(*) FROM comments
        WHERE comments.post_id = posts.id AND comments.deleted_at IS NULL
      )
      WHERE id = ANY(${postIds})
    `)
  }

  /**
   * Batch insert helper with progress tracking
   */
  private async batchInsert<T extends AnyTable>(
    table: T,
    values: T['$inferInsert'][],
    label: string,
    onConflict: 'error' | 'ignore' = 'error'
  ): Promise<void> {
    const batchSize = this.options.batchSize ?? 100

    for (let i = 0; i < values.length; i += batchSize) {
      const batch = values.slice(i, i + batchSize)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic table insert requires flexible typing
      const query = (this.db as any).insert(table).values(batch)

      if (onConflict === 'ignore') {
        await query.onConflictDoNothing()
      } else {
        await query
      }

      this.progress.progress(Math.min(i + batchSize, values.length), values.length, label)
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.sql.end()
  }
}

/**
 * Create and run an import
 */
export async function runImport(
  connectionString: string,
  data: IntermediateData,
  options: ImportOptions
): Promise<ImportResult> {
  const importer = new Importer(connectionString, options)
  try {
    return await importer.import(data)
  } finally {
    await importer.close()
  }
}
