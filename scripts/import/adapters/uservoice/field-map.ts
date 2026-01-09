/**
 * UserVoice field mappings
 *
 * Maps UserVoice export values to Quackback equivalents.
 */

const STATUS_MAP: Record<string, string> = {
  active: 'open',
  'under review': 'under_review',
  reviewing: 'under_review',
  planned: 'planned',
  started: 'in_progress',
  'in progress': 'in_progress',
  'working on it': 'in_progress',
  completed: 'complete',
  shipped: 'complete',
  done: 'complete',
  'already exists': 'complete',
  declined: 'closed',
  closed: 'closed',
  'will not implement': 'closed',
  "won't do": 'closed',
  duplicate: 'closed',
}

const MODERATION_MAP: Record<string, string> = {
  published: 'published',
  approved: 'published',
  pending: 'pending',
  'awaiting moderation': 'pending',
  spam: 'spam',
  archived: 'archived',
  hidden: 'archived',
}

export function normalizeStatus(status: string | undefined): string {
  if (!status) return 'open'
  return STATUS_MAP[status.toLowerCase().trim()] ?? 'open'
}

export function normalizeModeration(state: string | undefined): string {
  if (!state) return 'published'
  return MODERATION_MAP[state.toLowerCase().trim()] ?? 'published'
}

/**
 * Parse UserVoice timestamp to ISO format.
 * UserVoice format: "2025-07-21 03:37:03" (UTC)
 */
export function parseTimestamp(timestamp: string | undefined): string | undefined {
  if (!timestamp?.trim()) return undefined
  if (timestamp.includes('T')) return timestamp
  return timestamp.trim().replace(' ', 'T') + 'Z'
}
