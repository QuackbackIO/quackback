/**
 * Canny adapter
 *
 * Fetches data from the Canny REST API and converts it to the intermediate format.
 * Handles boards, posts, comments (threaded), votes, tags, categories,
 * changelog entries, and merged post relationships.
 */

import { CannyClient } from './client'
import type {
  CannyBoard,
  CannyPost,
  CannyComment,
  CannyVote,
  CannyTag,
  CannyCategory,
  CannyChangelogEntry,
} from './types'
import type {
  IntermediateData,
  IntermediatePost,
  IntermediateComment,
  IntermediateVote,
  IntermediateNote,
  IntermediateUser,
  IntermediateChangelog,
} from '../../schema/types'
import { normalizeStatus, normalizeModeration, embedImages } from './field-map'

export interface CannyAdapterOptions {
  apiKey: string
  /** Delay between API requests in ms (default: 200) */
  delayMs?: number
  verbose?: boolean
}

export interface CannyAdapterResult {
  data: IntermediateData
  stats: {
    boards: number
    posts: number
    comments: number
    notes: number
    votes: number
    tags: number
    categories: number
    changelogs: number
    mergedPosts: number
    users: number
  }
}

/**
 * Fetch all data from Canny API and convert to intermediate format
 */
export async function convertCanny(options: CannyAdapterOptions): Promise<CannyAdapterResult> {
  const log = options.verbose ? console.log.bind(console) : () => {}
  const client = new CannyClient({ apiKey: options.apiKey, delayMs: options.delayMs })

  const stats = {
    boards: 0,
    posts: 0,
    comments: 0,
    notes: 0,
    votes: 0,
    tags: 0,
    categories: 0,
    changelogs: 0,
    mergedPosts: 0,
    users: 0,
  }

  // ── Step 1: Fetch boards ───────────────────────────────────────
  log('   Fetching boards...')
  const cannyBoards = await client.post<{ boards: CannyBoard[] }>('/v1/boards/list')
  const boards = cannyBoards.boards ?? []
  stats.boards = boards.length
  log(`   Found ${boards.length} boards`)

  // ── Step 2: Fetch tags and categories ──────────────────────────
  log('   Fetching tags...')
  const cannyTags = await client.listAll<CannyTag>('/v1/tags/list', 'tags', {}, 10000)
  stats.tags = cannyTags.length
  log(`   Found ${cannyTags.length} tags`)

  log('   Fetching categories...')
  const cannyCategories = await client.listAll<CannyCategory>(
    '/v1/categories/list',
    'categories',
    {},
    10000
  )
  stats.categories = cannyCategories.length
  log(`   Found ${cannyCategories.length} categories`)

  // ── Step 3: Fetch posts (per board) ────────────────────────────
  log('   Fetching posts...')
  const allCannyPosts: CannyPost[] = []
  for (const board of boards) {
    log(`   Fetching posts for board: ${board.name}...`)
    const boardPosts = await client.listAll<CannyPost>('/v1/posts/list', 'posts', {
      boardID: board.id,
      sort: 'oldest',
    })
    allCannyPosts.push(...boardPosts)
    log(`   ${board.name}: ${boardPosts.length} posts`)
  }
  stats.posts = allCannyPosts.length
  log(`   Total: ${allCannyPosts.length} posts`)

  // Build reverse merge map: mergedPostId → canonicalPostId
  // A post with non-empty mergeHistory is the canonical target that absorbed other posts.
  // Each entry in mergeHistory references a post that was merged into this one.
  const mergeTargetMap = new Map<string, string>()
  for (const post of allCannyPosts) {
    if (post.mergeHistory && post.mergeHistory.length > 0) {
      for (const entry of post.mergeHistory) {
        mergeTargetMap.set(entry.post.id, post.id)
      }
    }
  }
  // Resolve merge chains: if A→B and B→C, resolve A→C
  for (const [mergedId, targetId] of mergeTargetMap) {
    let finalTarget = targetId
    const visited = new Set([mergedId])
    while (mergeTargetMap.has(finalTarget) && !visited.has(finalTarget)) {
      visited.add(finalTarget)
      finalTarget = mergeTargetMap.get(finalTarget)!
    }
    if (finalTarget !== targetId) {
      mergeTargetMap.set(mergedId, finalTarget)
    }
  }
  stats.mergedPosts = mergeTargetMap.size

  // ── Step 4: Fetch comments (v2 cursor-based) ──────────────────
  log('   Fetching comments...')
  const allCannyComments = await client.listAllCursor<CannyComment>('/v2/comments/list')
  log(`   Found ${allCannyComments.length} comments`)

  // ── Step 5: Fetch votes ────────────────────────────────────────
  log('   Fetching votes...')
  const allCannyVotes = await client.listAll<CannyVote>('/v1/votes/list', 'votes')
  stats.votes = allCannyVotes.length
  log(`   Found ${allCannyVotes.length} votes`)

  // ── Step 6: Fetch changelog entries ────────────────────────────
  log('   Fetching changelog entries...')
  const cannyChangelog = await client.listAll<CannyChangelogEntry>('/v1/entries/list', 'entries')
  stats.changelogs = cannyChangelog.length
  log(`   Found ${cannyChangelog.length} changelog entries`)

  // ── Transform to intermediate format ───────────────────────────

  // Collect unique users from all entities
  const seenEmails = new Set<string>()
  const users: IntermediateUser[] = []
  function trackUser(author: { email: string | null; name: string } | null) {
    if (!author?.email) return
    const email = author.email.toLowerCase()
    if (seenEmails.has(email)) return
    seenEmails.add(email)
    users.push({ email, name: author.name })
  }

  // Transform posts
  const intermediatePosts: IntermediatePost[] = []
  const cannyPostIds = new Set<string>()

  for (const post of allCannyPosts) {
    cannyPostIds.add(post.id)
    trackUser(post.author)

    // Collect tag names: Canny tags + category as a tag
    const tagNames: string[] = []
    if (post.tags) {
      for (const tag of post.tags) {
        tagNames.push(tag.name)
      }
    }
    if (post.category) {
      tagNames.push(post.category.name)
    }

    const body = embedImages(post.details || '', post.imageURLs)

    intermediatePosts.push({
      id: post.id,
      title: post.title,
      body: body || '(no description)',
      authorEmail: post.author?.email ?? undefined,
      authorName: post.author?.name,
      board: post.board?.name,
      status: post.status ? normalizeStatus(post.status) : undefined,
      moderation: normalizeModeration(mergeTargetMap.has(post.id)),
      tags: tagNames.length > 0 ? tagNames.join(',') : undefined,
      voteCount: post.score ?? 0,
      createdAt: post.created,
      mergedIntoId: mergeTargetMap.get(post.id),
    })
  }

  // Transform comments: route internal/private → notes, rest → comments
  const intermediateComments: IntermediateComment[] = []
  const intermediateNotes: IntermediateNote[] = []

  for (const comment of allCannyComments) {
    // Skip comments for posts we don't have
    if (!cannyPostIds.has(comment.post.id)) continue

    trackUser(comment.author)
    const body = embedImages(comment.value || '', comment.imageURLs)

    if (comment.internal) {
      // Internal comments → staff notes
      intermediateNotes.push({
        postId: comment.post.id,
        authorEmail: comment.author?.email ?? undefined,
        authorName: comment.author?.name,
        body,
        createdAt: comment.created,
      })
      stats.notes++
    } else {
      // Public and private comments → threaded comments
      intermediateComments.push({
        id: comment.id,
        postId: comment.post.id,
        parentId: comment.parentID ?? undefined,
        authorEmail: comment.author?.email ?? undefined,
        authorName: comment.author?.name,
        body,
        isStaff: comment.author?.isAdmin ?? false,
        isPrivate: comment.private || false,
        createdAt: comment.created,
      })
      stats.comments++
    }
  }

  // Transform votes
  const intermediateVotes: IntermediateVote[] = []
  for (const vote of allCannyVotes) {
    if (!cannyPostIds.has(vote.post.id)) continue

    if (!vote.voter?.email) continue
    trackUser(vote.voter)

    intermediateVotes.push({
      postId: vote.post.id,
      voterEmail: vote.voter.email,
      createdAt: vote.created,
    })
  }

  // Transform changelog entries
  const intermediateChangelogs: IntermediateChangelog[] = []
  for (const entry of cannyChangelog) {
    intermediateChangelogs.push({
      id: entry.id,
      title: entry.title,
      body: entry.markdownDetails || entry.plaintextDetails || '',
      publishedAt: entry.publishedAt ?? undefined,
      createdAt: entry.created,
      linkedPostIds: entry.posts?.map((p) => p.id) ?? [],
    })
  }

  stats.users = users.length

  return {
    data: {
      posts: intermediatePosts,
      comments: intermediateComments,
      votes: intermediateVotes,
      notes: intermediateNotes,
      users,
      changelogs: intermediateChangelogs,
    },
    stats,
  }
}

export function printStats(stats: CannyAdapterResult['stats']): void {
  console.log('\n━━━ Canny Export Summary ━━━')
  console.log(`  Boards:      ${stats.boards}`)
  console.log(`  Posts:        ${stats.posts} (${stats.mergedPosts} merged)`)
  console.log(`  Comments:    ${stats.comments}`)
  console.log(`  Notes:        ${stats.notes} (from internal comments)`)
  console.log(`  Votes:        ${stats.votes}`)
  console.log(`  Tags:         ${stats.tags}`)
  console.log(`  Categories:  ${stats.categories} (imported as tags)`)
  console.log(`  Changelog:   ${stats.changelogs}`)
  console.log(`  Users:        ${stats.users}`)
}
