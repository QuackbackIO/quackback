/**
 * UserVoice adapter
 *
 * Converts UserVoice export files to the intermediate format.
 */

import { parseCSVRaw } from '../../core/csv-parser'
import type { IntermediateData, IntermediateComment, IntermediateNote } from '../../schema/types'
import { deduplicateRows, type UserVoiceRow } from './deduplicator'
import { parseTimestamp } from './field-map'

export interface UserVoiceAdapterOptions {
  /** Path to the full suggestions export CSV (denormalized: idea + voter rows) */
  suggestionsFile: string
  /** Path to comments CSV (basic export format) */
  commentsFile?: string
  /** Path to notes CSV (basic export format) */
  notesFile?: string
  /** Verbose logging */
  verbose?: boolean
}

export interface AdapterResult {
  data: IntermediateData
  stats: {
    suggestionsRows: number
    uniquePosts: number
    extractedVotes: number
    duplicateVotes: number
    comments: number
    notes: number
  }
}

/**
 * Convert UserVoice exports to intermediate format
 */
export function convertUserVoice(options: UserVoiceAdapterOptions): AdapterResult {
  const log = options.verbose ? console.log.bind(console) : () => {}
  const stats = {
    suggestionsRows: 0,
    uniquePosts: 0,
    extractedVotes: 0,
    duplicateVotes: 0,
    comments: 0,
    notes: 0,
  }

  // Parse the main suggestions export
  log(`Reading suggestions from: ${options.suggestionsFile}`)
  const suggestionsRaw = parseCSVRaw(options.suggestionsFile)
  stats.suggestionsRows = suggestionsRaw.data.length
  log(`  Found ${suggestionsRaw.data.length} rows`)
  log(`  Fields: ${suggestionsRaw.fields.slice(0, 10).join(', ')}...`)

  // Convert to typed rows and deduplicate
  const rows = suggestionsRaw.data.map((row) => toUserVoiceRow(row))
  const deduped = deduplicateRows(rows)
  stats.uniquePosts = deduped.stats.uniquePosts
  stats.extractedVotes = deduped.stats.totalVotes
  stats.duplicateVotes = deduped.stats.duplicateVotes
  log(`  Deduplicated to ${deduped.posts.length} unique posts`)
  log(`  Extracted ${deduped.votes.length} votes`)

  // Parse comments if provided
  const commentsData = parseOptionalFile(options.commentsFile, convertComment, 'comments', log)
  stats.comments = commentsData.length

  // Parse notes if provided
  const notesData = parseOptionalFile(options.notesFile, convertNote, 'notes', log)
  stats.notes = notesData.length

  return {
    data: {
      posts: deduped.posts,
      votes: deduped.votes,
      comments: commentsData,
      notes: notesData,
    },
    stats,
  }
}

function toUserVoiceRow(row: Record<string, string>): UserVoiceRow {
  return {
    ideaId: row.ideaId ?? row.id ?? '',
    ideaTitle: row.ideaTitle ?? row.title ?? '',
    ideaDescription: row.ideaDescription ?? row.description ?? '',
    ideaCreatorEmailAddress: row.ideaCreatorEmailAddress,
    ideaCreatorName: row.ideaCreatorName,
    forumName: row.forumName,
    labels: row.labels,
    ideaListNames: row.ideaListNames,
    publicStatusName: row.publicStatusName,
    moderationState: row.moderationState,
    votersCount: row.votersCount,
    createdTimestamp: row.createdTimestamp,
    publicStatusUpdateMessage: row.publicStatusUpdateMessage,
    publicStatusUpdatedTimestamp: row.publicStatusUpdatedTimestamp,
    publicStatusCreatorEmailAddress: row.publicStatusCreatorEmailAddress,
    userEmailAddress: row.userEmailAddress,
    userName: row.userName,
    linkedIdeaCreationDate: row.linkedIdeaCreationDate,
  }
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
  // The comment CSV uses "Suggestion ID" or "suggestionId" after normalization
  const postId = row.suggestionId ?? row.id
  const body = row.text ?? row.body

  if (!postId || !body?.trim()) {
    return null
  }

  // Determine if this is a staff member
  // UserVoice doesn't have a direct flag, but we could check email domain
  const isStaff = false // Default to false, could be enhanced

  return {
    postId,
    authorEmail: row.userEmail?.trim() || undefined,
    authorName: row.userName?.trim() || undefined,
    body: body.trim(),
    isStaff,
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
 * Print adapter statistics
 */
export function printStats(stats: AdapterResult['stats']): void {
  console.log('\n━━━ UserVoice Conversion Stats ━━━')
  console.log(`  Suggestions rows: ${stats.suggestionsRows}`)
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
}
