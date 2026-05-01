/**
 * API-based importer
 *
 * Imports IntermediateData into Quackback purely via the REST API.
 * No database access needed — requires only a Quackback URL and API key.
 */

import { QuackbackClient } from './quackback-client'
import type { IntermediateData, ImportResult, ImportError } from '../schema/types'
import { Progress } from './progress'

export interface ApiImportOptions {
  /** Quackback API base URL (e.g., https://app.quackback.io) */
  quackbackUrl: string
  /** Quackback admin API key */
  quackbackKey: string
  /** Pre-converted intermediate data to import */
  data: IntermediateData
  /** Validate only, don't insert */
  dryRun?: boolean
  /** Verbose output */
  verbose?: boolean
  /**
   * Top-up an instance that has been imported before. Skip rows already
   * present on the server: posts dedup by normalised title + createdAt date,
   * comments dedup by normalised content + createdAt minute on a per-post
   * cache. Votes and user identify are already idempotent server-side.
   */
  incremental?: boolean
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function dayKey(ts: Date | string | null | undefined): string {
  if (!ts) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function minuteKey(ts: Date | string | null | undefined): string {
  if (!ts) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 16)
}

function postDedupKey(title: string, createdAt: Date | string | null | undefined): string | null {
  const day = dayKey(createdAt)
  if (!day) return null
  return `${normalizeText(title)}|${day}`
}

function commentDedupKey(
  content: string,
  createdAt: Date | string | null | undefined
): string | null {
  const min = minuteKey(createdAt)
  if (!min) return null
  return `${normalizeText(content)}|${min}`
}

interface ExistingComment {
  id: string
  content: string
  createdAt: string
  replies?: ExistingComment[]
}

function flattenComments(cs: ExistingComment[]): ExistingComment[] {
  return cs.flatMap((c) => [c, ...flattenComments(c.replies ?? [])])
}

interface IdMap {
  /** External source ID → Quackback post ID */
  posts: Map<string, string>
  /** External source comment ID → Quackback comment ID */
  comments: Map<string, string>
  /** Email → Quackback principal ID */
  users: Map<string, string>
}

/**
 * Run a full import via the Quackback REST API
 */
export async function runApiImport(options: ApiImportOptions): Promise<ImportResult> {
  const progress = new Progress(options.verbose ?? false)
  const startTime = Date.now()
  const errors: ImportError[] = []

  const result: ImportResult = {
    posts: { imported: 0, skipped: 0, errors: 0 },
    comments: { imported: 0, skipped: 0, errors: 0 },
    votes: { imported: 0, skipped: 0, errors: 0 },
    notes: { imported: 0, skipped: 0, errors: 0 },
    changelogs: { imported: 0, skipped: 0, errors: 0 },
    duration: 0,
    errors: [],
  }

  const { data } = options

  if (options.dryRun) {
    progress.info('[DRY RUN] Skipping Quackback API calls')
    logDryRunSummary(data, progress)
    result.duration = Date.now() - startTime
    progress.summary(result)
    return result
  }

  // Create Quackback client
  const qb = new QuackbackClient({
    baseUrl: options.quackbackUrl,
    apiKey: options.quackbackKey,
    importMode: true,
  })

  const idMap: IdMap = {
    posts: new Map(),
    comments: new Map(),
    users: new Map(),
  }

  // Dedup state, only populated when options.incremental is set
  const existingPostByKey = new Map<string, string>()
  const preExistingPostIds = new Set<string>()
  // Per-post: dedupKey -> Quackback comment id. Stored as a map (not a set) so
  // that when a UV comment is matched against an existing one, we can register
  // idMap.comments for it and let new replies under that parent attach.
  const existingCommentsByPost = new Map<string, Map<string, string>>()

  async function getExistingComments(postId: string): Promise<Map<string, string>> {
    const cached = existingCommentsByPost.get(postId)
    if (cached) return cached
    const resp = await qb.get<{ data: ExistingComment[] }>(`/api/v1/posts/${postId}/comments`)
    const flat = flattenComments(resp.data ?? [])
    const byKey = new Map<string, string>()
    for (const c of flat) {
      const k = commentDedupKey(c.content, c.createdAt)
      if (k) byKey.set(k, c.id)
    }
    existingCommentsByPost.set(postId, byKey)
    return byKey
  }

  if (options.incremental) {
    progress.start('Pre-fetching existing posts for dedup')
    // showDeleted=true so soft-deleted posts are still in the dedup index;
    // re-importing a UV idea whose Quackback row was deleted should not
    // resurrect it as a duplicate.
    const existing = await qb.listAll<{ id: string; title: string; createdAt: string }>(
      '/api/v1/posts',
      { showDeleted: 'true' }
    )
    for (const p of existing) {
      const key = postDedupKey(p.title, p.createdAt)
      if (key) existingPostByKey.set(key, p.id)
    }
    progress.success(`Loaded ${existing.length} existing posts (${existingPostByKey.size} keyed)`)
  }

  // Step 1: Identify users
  if (data.users.length > 0) {
    progress.start(`Identifying ${data.users.length} users`)
    let identified = 0
    for (const user of data.users) {
      try {
        const resp = await qb.post<{ data: { principalId: string } }>('/api/v1/users/identify', {
          email: user.email,
          name: user.name ?? user.email.split('@')[0],
        })
        idMap.users.set(user.email.toLowerCase(), resp.data.principalId)
        identified++
      } catch (err) {
        if (options.verbose) {
          progress.warn(`Failed to identify user ${user.email}: ${err}`)
        }
      }
    }
    progress.success(`${identified} users identified`)
  }

  // Step 2: Resolve boards and statuses (fetch existing from API)
  progress.start('Resolving boards and statuses')
  const existingBoards = await qb.listAll<{ id: string; slug: string; name: string }>(
    '/api/v1/boards'
  )
  const boardMap = new Map<string, string>()
  for (const b of existingBoards) {
    boardMap.set(b.name.toLowerCase(), b.id)
    boardMap.set(b.slug, b.id)
  }

  const existingStatuses = await qb.listAll<{ id: string; slug: string; name: string }>(
    '/api/v1/statuses'
  )
  const statusMap = new Map<string, string>()
  for (const s of existingStatuses) {
    statusMap.set(s.slug, s.id)
    statusMap.set(s.name.toLowerCase(), s.id)
  }

  // Resolve tags
  const existingTags = await qb.listAll<{ id: string; name: string }>('/api/v1/tags')
  const tagMap = new Map<string, string>()
  for (const t of existingTags) {
    tagMap.set(t.name.toLowerCase(), t.id)
  }
  progress.success(
    `Boards: ${existingBoards.length}, Statuses: ${existingStatuses.length}, Tags: ${existingTags.length}`
  )

  // Step 3: Import posts
  if (data.posts.length > 0) {
    progress.start(`Importing ${data.posts.length} posts`)

    for (let i = 0; i < data.posts.length; i++) {
      const post = data.posts[i]
      try {
        // Resolve board
        const boardId = post.board
          ? (boardMap.get(post.board.toLowerCase()) ?? boardMap.get(toSlug(post.board)))
          : undefined

        if (!boardId) {
          result.posts.skipped++
          if (options.verbose) {
            progress.warn(`Skipping post "${post.title}": no board found for "${post.board}"`)
          }
          continue
        }

        // Incremental dedup against existing Quackback posts
        if (options.incremental) {
          const key = postDedupKey(post.title, post.createdAt)
          const existingId = key ? existingPostByKey.get(key) : undefined
          if (existingId) {
            idMap.posts.set(post.id, existingId)
            preExistingPostIds.add(existingId)
            result.posts.skipped++
            continue
          }
        }

        // Resolve status
        const statusId = post.status
          ? (statusMap.get(post.status) ?? statusMap.get(post.status.toLowerCase()))
          : undefined

        // Resolve tags
        const tagIds: string[] = []
        if (post.tags) {
          for (const tagName of post.tags.split(',').map((t) => t.trim().toLowerCase())) {
            const tagId = tagMap.get(tagName)
            if (tagId) tagIds.push(tagId)
          }
        }

        const resp = await qb.post<{ data: { id: string } }>('/api/v1/posts', {
          boardId,
          title: post.title,
          content: post.body,
          ...(statusId && { statusId }),
          ...(tagIds.length > 0 && { tagIds }),
          ...(post.createdAt && { createdAt: new Date(post.createdAt).toISOString() }),
        })

        idMap.posts.set(post.id, resp.data.id)
        result.posts.imported++

        if (options.verbose && (i + 1) % 100 === 0) {
          progress.progress(i + 1, data.posts.length, 'Posts')
        }
      } catch (err) {
        result.posts.errors++
        errors.push({
          type: 'post',
          externalId: post.id,
          message: err instanceof Error ? err.message : String(err),
        })
        if (options.verbose) {
          progress.warn(`Failed to import post "${post.title}": ${err}`)
        }
      }
    }
    progress.success(
      `Posts: ${result.posts.imported} imported, ${result.posts.skipped} skipped, ${result.posts.errors} errors`
    )
  }

  // Step 4: Import comments (root comments first, then replies)
  if (data.comments.length > 0) {
    progress.start(`Importing ${data.comments.length} comments`)

    // Topological sort: parents always come before their children
    const commentById = new Map(data.comments.filter((c) => c.id).map((c) => [c.id!, c]))
    const sortedComments: typeof data.comments = []
    const visited = new Set<string>()

    function visit(comment: (typeof data.comments)[0]) {
      const key = comment.id ?? `${comment.postId}:${comment.createdAt}`
      if (visited.has(key)) return
      // Visit parent first if it exists
      if (comment.parentId && commentById.has(comment.parentId)) {
        visit(commentById.get(comment.parentId)!)
      }
      visited.add(key)
      sortedComments.push(comment)
    }

    for (const comment of data.comments) visit(comment)

    for (let i = 0; i < sortedComments.length; i++) {
      const comment = sortedComments[i]
      try {
        const postId = idMap.posts.get(comment.postId)
        if (!postId) {
          result.comments.skipped++
          continue
        }

        // Resolve parent comment - skip reply if parent wasn't imported
        let parentId: string | undefined
        if (comment.parentId) {
          parentId = idMap.comments.get(comment.parentId)
          if (!parentId) {
            result.comments.skipped++
            continue
          }
        }

        // Incremental dedup: only check pre-existing posts (newly created
        // posts in this run have no comments yet, so the GET would be wasted)
        if (options.incremental && preExistingPostIds.has(postId)) {
          const dedupKey = commentDedupKey(comment.body, comment.createdAt)
          if (dedupKey) {
            const existingByKey = await getExistingComments(postId)
            const existingCommentId = existingByKey.get(dedupKey)
            if (existingCommentId) {
              // Register the mapping so new replies under this parent in the
              // current run can still resolve their parentId.
              if (comment.id) idMap.comments.set(comment.id, existingCommentId)
              result.comments.skipped++
              continue
            }
          }
        }

        const resp = await qb.post<{ data: { id: string } }>(`/api/v1/posts/${postId}/comments`, {
          content: comment.body,
          ...(parentId && { parentId }),
          ...(comment.isPrivate && { isPrivate: true }),
          ...(comment.createdAt && { createdAt: new Date(comment.createdAt).toISOString() }),
        })

        // Track comment ID for threading
        if (comment.id) {
          idMap.comments.set(comment.id, resp.data.id)
        }
        // Record in the per-post dedup cache so repeated rows in the same run
        // are also caught
        if (options.incremental && preExistingPostIds.has(postId)) {
          const dedupKey = commentDedupKey(comment.body, comment.createdAt)
          if (dedupKey) (await getExistingComments(postId)).set(dedupKey, resp.data.id)
        }

        result.comments.imported++

        if (options.verbose && (i + 1) % 100 === 0) {
          progress.progress(i + 1, sortedComments.length, 'Comments')
        }
      } catch (err) {
        result.comments.errors++
        errors.push({
          type: 'comment',
          externalId: comment.postId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    progress.success(
      `Comments: ${result.comments.imported} imported, ${result.comments.skipped} skipped, ${result.comments.errors} errors`
    )
  }

  // Step 5: Import votes
  if (data.votes.length > 0) {
    progress.start(`Importing ${data.votes.length} votes`)

    for (let i = 0; i < data.votes.length; i++) {
      const vote = data.votes[i]
      try {
        const postId = idMap.posts.get(vote.postId)
        if (!postId) {
          result.votes.skipped++
          continue
        }

        // Identify voter on the fly if not already in the map
        let principalId = idMap.users.get(vote.voterEmail.toLowerCase())
        if (!principalId) {
          try {
            const resp = await qb.post<{ data: { principalId: string } }>(
              '/api/v1/users/identify',
              {
                email: vote.voterEmail,
                name: vote.voterEmail.split('@')[0],
              }
            )
            principalId = resp.data.principalId
            idMap.users.set(vote.voterEmail.toLowerCase(), principalId)
          } catch {
            result.votes.skipped++
            continue
          }
        }

        await qb.post(`/api/v1/posts/${postId}/vote/proxy`, {
          voterPrincipalId: principalId,
          ...(vote.createdAt && { createdAt: new Date(vote.createdAt).toISOString() }),
        })

        result.votes.imported++

        if (options.verbose && (i + 1) % 500 === 0) {
          progress.progress(i + 1, data.votes.length, 'Votes')
        }
      } catch (err) {
        result.votes.errors++
        errors.push({
          type: 'vote',
          externalId: vote.postId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    progress.success(
      `Votes: ${result.votes.imported} imported, ${result.votes.skipped} skipped, ${result.votes.errors} errors`
    )
  }

  // Step 6: Import notes as private comments
  if (data.notes.length > 0) {
    progress.start(`Importing ${data.notes.length} notes as private comments`)

    for (let i = 0; i < data.notes.length; i++) {
      const note = data.notes[i]
      try {
        const postId = idMap.posts.get(note.postId)
        if (!postId) {
          result.notes.skipped++
          continue
        }

        if (options.incremental && preExistingPostIds.has(postId)) {
          const dedupKey = commentDedupKey(note.body, note.createdAt)
          if (dedupKey) {
            const existingByKey = await getExistingComments(postId)
            if (existingByKey.has(dedupKey)) {
              result.notes.skipped++
              continue
            }
          }
        }

        const resp = await qb.post<{ data: { id: string } }>(`/api/v1/posts/${postId}/comments`, {
          content: note.body,
          isPrivate: true,
          ...(note.createdAt && { createdAt: new Date(note.createdAt).toISOString() }),
        })

        if (options.incremental && preExistingPostIds.has(postId)) {
          const dedupKey = commentDedupKey(note.body, note.createdAt)
          if (dedupKey) (await getExistingComments(postId)).set(dedupKey, resp.data.id)
        }

        result.notes.imported++
      } catch (err) {
        result.notes.errors++
        errors.push({
          type: 'note',
          externalId: note.postId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    progress.success(
      `Notes: ${result.notes.imported} imported, ${result.notes.skipped} skipped, ${result.notes.errors} errors`
    )
  }

  // Step 7: Merge posts
  const mergedPosts = data.posts.filter((p) => p.mergedIntoId)
  if (mergedPosts.length > 0) {
    progress.start(`Merging ${mergedPosts.length} posts`)
    let mergeCount = 0

    for (const post of mergedPosts) {
      const duplicateId = idMap.posts.get(post.id)
      const canonicalId = idMap.posts.get(post.mergedIntoId!)
      if (!duplicateId || !canonicalId) continue

      try {
        await qb.post(`/api/v1/posts/${duplicateId}/merge`, {
          canonicalPostId: canonicalId,
        })
        mergeCount++
      } catch (err) {
        if (options.verbose) {
          progress.warn(`Failed to merge post ${post.id}: ${err}`)
        }
      }
    }
    progress.success(`${mergeCount} posts merged`)
  }

  // Step 8: Import changelog entries
  if (data.changelogs.length > 0) {
    progress.start(`Importing ${data.changelogs.length} changelog entries`)

    for (const entry of data.changelogs) {
      try {
        // Resolve linked post IDs
        const linkedPostIds: string[] = []
        for (const externalPostId of entry.linkedPostIds) {
          const postId = idMap.posts.get(externalPostId)
          if (postId) linkedPostIds.push(postId)
        }

        await qb.post('/api/v1/changelog', {
          title: entry.title,
          content: entry.body,
          ...(entry.publishedAt && { publishedAt: new Date(entry.publishedAt).toISOString() }),
          ...(linkedPostIds.length > 0 && { linkedPostIds }),
        })

        result.changelogs.imported++
      } catch (err) {
        result.changelogs.errors++
        errors.push({
          type: 'changelog',
          externalId: entry.id,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    progress.success(
      `Changelog: ${result.changelogs.imported} imported, ${result.changelogs.errors} errors`
    )
  }

  result.duration = Date.now() - startTime
  result.errors = errors
  progress.summary(result)

  return result
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function logDryRunSummary(data: IntermediateData, progress: Progress): void {
  progress.info(`[DRY RUN] Would import:`)
  progress.info(`  ${data.posts.length} posts`)
  progress.info(`  ${data.comments.length} comments`)
  progress.info(`  ${data.votes.length} votes`)
  progress.info(`  ${data.notes.length} notes`)
  progress.info(`  ${data.changelogs.length} changelog entries`)
  progress.info(`  ${data.users.length} users`)

  const mergedCount = data.posts.filter((p) => p.mergedIntoId).length
  if (mergedCount > 0) {
    progress.info(`  ${mergedCount} merge relationships`)
  }
}
