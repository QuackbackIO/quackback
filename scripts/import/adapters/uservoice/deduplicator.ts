/**
 * UserVoice deduplicator
 *
 * Handles the denormalized full export format where each row represents
 * an idea + voter relationship. Extracts unique posts and individual votes.
 */

import type { IntermediatePost, IntermediateVote, ModerationState } from '../../schema/types'
import { normalizeStatus, normalizeModeration, parseTimestamp } from './field-map'

/**
 * Raw row from UserVoice full export
 */
export interface UserVoiceRow {
  // Core idea fields
  ideaId: string
  ideaTitle: string
  ideaDescription: string

  // Creator info
  ideaCreatorEmailAddress?: string
  ideaCreatorName?: string

  // Classification
  forumName?: string
  categoryName?: string
  labels?: string
  ideaListNames?: string

  // Status
  publicStatusName?: string
  moderationState?: string

  // Metrics
  votersCount?: string

  // Timestamps
  createdTimestamp?: string

  // Official response
  publicStatusUpdateMessage?: string
  publicStatusUpdatedTimestamp?: string
  publicStatusCreatorEmailAddress?: string

  // Voter info (the person who voted, not the creator)
  userEmailAddress?: string
  userName?: string
  linkedIdeaCreationDate?: string

  // Allow any other fields
  [key: string]: string | undefined
}

/**
 * Deduplication result
 */
export interface DeduplicationResult {
  posts: IntermediatePost[]
  votes: IntermediateVote[]
  stats: {
    totalRows: number
    uniquePosts: number
    totalVotes: number
    duplicateVotes: number
  }
}

/**
 * Deduplicate UserVoice full export rows
 *
 * The full export is denormalized: each row is an idea + voter pair.
 * This function:
 * 1. Groups rows by Idea ID
 * 2. Takes the first occurrence for post data
 * 3. Extracts a vote from each row with a voter email
 */
export function deduplicateRows(rows: UserVoiceRow[]): DeduplicationResult {
  const postsMap = new Map<string, IntermediatePost>()
  const votesMap = new Map<string, IntermediateVote>() // Key: ideaId:email
  const stats = {
    totalRows: rows.length,
    uniquePosts: 0,
    totalVotes: 0,
    duplicateVotes: 0,
  }

  for (const row of rows) {
    const ideaId = row.ideaId?.trim()
    if (!ideaId) continue

    // Extract post if not already seen
    if (!postsMap.has(ideaId)) {
      const post = extractPost(row)
      if (post) {
        postsMap.set(ideaId, post)
      }
    }

    // Extract vote if voter email present
    const voterEmail = row.userEmailAddress?.trim()?.toLowerCase()
    if (voterEmail) {
      const voteKey = `${ideaId}:${voterEmail}`
      if (!votesMap.has(voteKey)) {
        votesMap.set(voteKey, {
          postId: ideaId,
          voterEmail,
          createdAt: parseTimestamp(row.linkedIdeaCreationDate),
        })
        stats.totalVotes++
      } else {
        stats.duplicateVotes++
      }
    }
  }

  stats.uniquePosts = postsMap.size

  return {
    posts: Array.from(postsMap.values()),
    votes: Array.from(votesMap.values()),
    stats,
  }
}

/**
 * Extract post data from a row
 */
function extractPost(row: UserVoiceRow): IntermediatePost | null {
  const ideaId = row.ideaId?.trim()
  const title = row.ideaTitle?.trim()
  const body = row.ideaDescription?.trim() || ''

  if (!ideaId || !title) {
    return null
  }

  return {
    id: ideaId,
    title,
    body,
    authorEmail: row.ideaCreatorEmailAddress?.trim() || undefined,
    authorName: row.ideaCreatorName?.trim() || undefined,
    board: row.categoryName?.trim() || row.forumName?.trim() || undefined,
    status: normalizeStatus(row.publicStatusName),
    moderation: normalizeModeration(row.moderationState) as ModerationState,
    tags: parseLabelsField(row.labels),
    roadmap: parseFirstRoadmap(row.ideaListNames),
    voteCount: parseVoteCount(row.votersCount),
    createdAt: parseTimestamp(row.createdTimestamp),
    response: row.publicStatusUpdateMessage?.trim() || undefined,
    responseAt: parseTimestamp(row.publicStatusUpdatedTimestamp),
    responseBy: row.publicStatusCreatorEmailAddress?.trim() || undefined,
  }
}

/**
 * Parse labels field - handles JSON arrays like ["Tag1","Tag2"] or plain comma-separated strings
 */
function parseLabelsField(labels: string | undefined): string | undefined {
  if (!labels?.trim()) return undefined
  const trimmed = labels.trim()
  // Check if it's a JSON array
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as string[]
      return parsed.join(',')
    } catch {
      // Not valid JSON, return as-is
      return trimmed
    }
  }
  return trimmed
}

/**
 * Parse first roadmap from comma-separated list
 */
function parseFirstRoadmap(listNames: string | undefined): string | undefined {
  if (!listNames?.trim()) return undefined
  const first = listNames.split(',')[0]?.trim()
  // Convert to slug format
  return first
    ? first
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : undefined
}

/**
 * Parse vote count, handling various formats
 */
function parseVoteCount(count: string | undefined): number {
  if (!count?.trim()) return 0
  const parsed = parseInt(count, 10)
  return isNaN(parsed) ? 0 : Math.max(0, parsed)
}
