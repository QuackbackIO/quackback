/**
 * UserVoice field mappings (§I3). Collapses UserVoice's admin-typed status
 * text into the same generic labels Quackback seeds by default (Open,
 * Under Review, Planned, In Progress, Complete, Closed) so the wizard's
 * status-mapping step auto-matches on a fresh instance instead of asking
 * the admin to map dozens of near-duplicate source strings.
 */

const STATUS_MAP: Record<string, string> = {
  active: 'Open',
  'under review': 'Under Review',
  reviewing: 'Under Review',
  planned: 'Planned',
  started: 'In Progress',
  'in progress': 'In Progress',
  'working on it': 'In Progress',
  completed: 'Complete',
  shipped: 'Complete',
  done: 'Complete',
  'already exists': 'Complete',
  declined: 'Closed',
  closed: 'Closed',
  'will not implement': 'Closed',
  "won't do": 'Closed',
  duplicate: 'Closed',
}

export function normalizeStatus(status: string | undefined): string {
  if (!status) return 'Open'
  return STATUS_MAP[status.toLowerCase().trim()] ?? status.trim()
}

/**
 * Parse a UserVoice timestamp ("2025-07-21 03:37:03", UTC, no timezone) to
 * ISO 8601.
 */
export function parseTimestamp(timestamp: string | undefined): string | undefined {
  if (!timestamp?.trim()) return undefined
  if (timestamp.includes('T')) return timestamp
  return timestamp.trim().replace(' ', 'T') + 'Z'
}
