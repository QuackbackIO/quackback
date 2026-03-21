/**
 * API-based Canny importer
 *
 * Imports Canny data into Quackback purely via the REST API,
 * requiring only a Canny API key and a Quackback API key.
 * No database access needed.
 */

import { QuackbackClient } from './quackback-client'
import { convertCanny, printStats } from './adapter'
import type { IntermediateData, ImportResult, ImportError } from '../../schema/types'
import { Progress } from '../../core/progress'

export interface ApiImportOptions {
  /** Canny API key */
  cannyApiKey: string
  /** Quackback API base URL (e.g., https://app.quackback.io) */
  quackbackUrl: string
  /** Quackback admin API key */
  quackbackKey: string
  /** Validate only, don't insert */
  dryRun?: boolean
  /** Verbose output */
  verbose?: boolean
}

interface IdMap {
  /** External Canny ID → Quackback post ID */
  posts: Map<string, string>
  /** External Canny comment ID → Quackback comment ID */
  comments: Map<string, string>
  /** Email → Quackback principal ID */
  users: Map<string, string>
}

/**
 * Run a full Canny → Quackback import via API
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

  // Step 1: Fetch from Canny
  progress.start('Fetching data from Canny API')
  const cannyResult = await convertCanny({
    apiKey: options.cannyApiKey,
    verbose: options.verbose,
  })

  if (options.verbose) {
    printStats(cannyResult.stats)
  }

  const { data } = cannyResult

  if (options.dryRun) {
    progress.info('[DRY RUN] Skipping Quackback API calls')
    logDryRunSummary(data, progress)
    result.duration = Date.now() - startTime
    progress.summary(result)
    return result
  }

  // Step 2: Create Quackback client
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

  // Step 3: Identify users
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

  // Step 4: Resolve boards and statuses (fetch existing from API)
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

  // Step 5: Import posts
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

  // Step 6: Import comments (root comments first, then replies)
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

  // Step 7: Import votes
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

  // Step 8: Import notes as private comments
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

        await qb.post(`/api/v1/posts/${postId}/comments`, {
          content: note.body,
          isPrivate: true,
          ...(note.createdAt && { createdAt: new Date(note.createdAt).toISOString() }),
        })

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

  // Step 9: Merge posts
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

  // Step 10: Import changelog entries
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
