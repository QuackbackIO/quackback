import type { ExternalStatusItem } from '@/lib/server/integrations/types'

/**
 * The issue states GitHub sync maps: an issue is open or closed, and a close
 * says whether the work was done (`Closed`) or dropped (`Closed (not
 * planned)`, GitHub's `state_reason: not_planned`). A mapping made for
 * `Closed` also covers a not-planned close that has no mapping of its own.
 */
export const GITHUB_ISSUE_STATES = ['Open', 'Closed', 'Closed (not planned)'] as const

/** The mapping UI shows the fixed set. */
export async function fetchGitHubStatuses(): Promise<ExternalStatusItem[]> {
  return GITHUB_ISSUE_STATES.map((state) => ({ id: state, name: state }))
}
