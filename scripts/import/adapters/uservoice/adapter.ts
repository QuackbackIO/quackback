/**
 * UserVoice adapter
 *
 * Converts UserVoice export files to the intermediate format.
 *
 * Uses the full suggestions export (denormalized format with one row per voter)
 * to extract both posts and individual vote records.
 */

import { parseCSVRaw } from '../../core/csv-parser'
import type {
  IntermediateData,
  IntermediatePost,
  IntermediateVote,
  IntermediateComment,
  IntermediateNote,
  IntermediateUser,
  ModerationState,
} from '../../schema/types'
import { normalizeStatus, normalizeModeration, parseTimestamp } from './field-map'

export interface UserVoiceAdapterOptions {
  /** Path to full suggestions export CSV (denormalized: one row per voter) */
  suggestionsFile: string
  /** Path to comments CSV */
  commentsFile?: string
  /** Path to notes CSV */
  notesFile?: string
  /** Path to subdomain users CSV */
  usersFile?: string
  /** Verbose logging */
  verbose?: boolean
}

export interface AdapterResult {
  data: IntermediateData
  stats: {
    totalRows: number
    uniquePosts: number
    extractedVotes: number
    duplicateVotes: number
    comments: number
    notes: number
    users: number
  }
}

/**
 * Convert UserVoice exports to intermediate format
 */
export function convertUserVoice(options: UserVoiceAdapterOptions): AdapterResult {
  const log = options.verbose ? console.log.bind(console) : () => {}
  const stats = {
    totalRows: 0,
    uniquePosts: 0,
    extractedVotes: 0,
    duplicateVotes: 0,
    comments: 0,
    notes: 0,
    users: 0,
  }

  // Parse the full export (denormalized format)
  log(`Reading suggestions from: ${options.suggestionsFile}`)
  const suggestionsRaw = parseCSVRaw(options.suggestionsFile)
  stats.totalRows = suggestionsRaw.data.length
  log(`  Found ${suggestionsRaw.data.length} rows`)
  log(`  Fields: ${suggestionsRaw.fields.slice(0, 10).join(', ')}...`)

  // Deduplicate posts and extract votes from denormalized format
  const deduped = deduplicateFullExport(suggestionsRaw.data)
  stats.uniquePosts = deduped.uniquePosts
  stats.extractedVotes = deduped.totalVotes
  stats.duplicateVotes = deduped.duplicateVotes
  log(`  Deduplicated to ${deduped.posts.length} unique posts`)
  log(`  Extracted ${deduped.votes.length} votes`)

  // Parse comments if provided
  const commentsData = parseOptionalFile(options.commentsFile, convertComment, 'comments', log)
  stats.comments = commentsData.length

  // Parse notes if provided
  const notesData = parseOptionalFile(options.notesFile, convertNote, 'notes', log)
  stats.notes = notesData.length

  // Parse users if provided
  const usersData = parseOptionalFile(options.usersFile, convertUser, 'users', log)
  stats.users = usersData.length

  return {
    data: {
      posts: deduped.posts,
      votes: deduped.votes,
      comments: commentsData,
      notes: notesData,
      users: usersData,
    },
    stats,
  }
}

/**
 * Deduplicate full export - extracts posts and votes from denormalized format
 */
function deduplicateFullExport(rows: Record<string, string>[]): {
  posts: IntermediatePost[]
  votes: IntermediateVote[]
  uniquePosts: number
  totalVotes: number
  duplicateVotes: number
} {
  const postsMap = new Map<string, IntermediatePost>()
  const votesMap = new Map<string, IntermediateVote>()
  let duplicateVotes = 0

  for (const row of rows) {
    const ideaId = row.ideaId?.trim()
    if (!ideaId) continue

    // Extract post if not already seen
    if (!postsMap.has(ideaId)) {
      const post = convertFullExportPost(row)
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
      } else {
        duplicateVotes++
      }
    }
  }

  return {
    posts: Array.from(postsMap.values()),
    votes: Array.from(votesMap.values()),
    uniquePosts: postsMap.size,
    totalVotes: votesMap.size,
    duplicateVotes,
  }
}

/**
 * Convert a row from the full export format to an IntermediatePost
 */
function convertFullExportPost(row: Record<string, string>): IntermediatePost | null {
  const id = row.ideaId?.trim()
  const title = row.ideaTitle?.trim()
  const body = row.ideaDescription?.trim() || ''

  if (!id || !title) {
    return null
  }

  return {
    id,
    title,
    body,
    authorEmail: row.ideaCreatorEmailAddress?.trim() || undefined,
    authorName: row.ideaCreatorName?.trim() || undefined,
    board: row.categoryName?.trim() || row.forumName?.trim() || undefined,
    status: normalizeStatus(row.publicStatusName),
    moderation: normalizeModeration(row.moderationState) as ModerationState,
    tags: parseLabelsField(row.labels),
    roadmap: parseFirstRoadmap(row.ideaListNames),
    voteCount: parseInt(row.votersCount || '0', 10) || 0,
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
  return first
    ? first
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : undefined
}

function parseOptionalFile<T>(
  filePath: string | undefined,
  converter: (row: Record<string, string>) => T | null,
  label: string,
  log: (msg: string) => void
): T[] {
  if (!filePath) return []

  log(`Reading ${label} from: ${filePath}`)
  const raw = parseCSVRaw(filePath)
  const results: T[] = []

  for (const row of raw.data) {
    const converted = converter(row)
    if (converted) results.push(converted)
  }

  log(`  Parsed ${results.length} ${label}`)
  return results
}

/**
 * Convert a comment row from the basic export format
 */
function convertComment(row: Record<string, string>): IntermediateComment | null {
  const postId = row.suggestionId ?? row.id
  const body = row.text ?? row.body

  if (!postId || !body?.trim()) {
    return null
  }

  return {
    postId,
    authorEmail: row.userEmail?.trim() || undefined,
    authorName: row.userName?.trim() || undefined,
    body: body.trim(),
    isStaff: false,
    createdAt: parseTimestamp(row.createdAt),
  }
}

/**
 * Convert a note row from the basic export format
 */
function convertNote(row: Record<string, string>): IntermediateNote | null {
  const postId = row.suggestionId ?? row.id
  const body = row.text ?? row.body

  if (!postId || !body?.trim()) {
    return null
  }

  return {
    postId,
    authorEmail: row.userEmail?.trim() || undefined,
    authorName: row.userName?.trim() || undefined,
    body: body.trim(),
    createdAt: parseTimestamp(row.createdAt),
  }
}

/**
 * Convert a user row from the subdomain users export
 */
function convertUser(row: Record<string, string>): IntermediateUser | null {
  const email = row.email?.trim()?.toLowerCase()
  if (!email) {
    return null
  }

  return {
    email,
    name: row.name?.trim() || undefined,
    createdAt: parseTimestamp(row.createdAt),
  }
}

/**
 * Print adapter statistics
 */
export function printStats(stats: AdapterResult['stats']): void {
  console.log('\n━━━ UserVoice Conversion Stats ━━━')
  console.log(`  Total rows:       ${stats.totalRows}`)
  console.log(`  Unique posts:     ${stats.uniquePosts}`)
  console.log(`  Extracted votes:  ${stats.extractedVotes}`)
  if (stats.duplicateVotes > 0) {
    console.log(`  Duplicate votes:  ${stats.duplicateVotes} (skipped)`)
  }
  if (stats.comments > 0) {
    console.log(`  Comments:         ${stats.comments}`)
  }
  if (stats.notes > 0) {
    console.log(`  Notes:            ${stats.notes}`)
  }
  if (stats.users > 0) {
    console.log(`  Users:            ${stats.users}`)
  }
}
