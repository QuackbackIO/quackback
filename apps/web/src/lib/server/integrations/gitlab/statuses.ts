import type { ExternalStatusItem } from '../types'

/**
 * GitLab issues have exactly two states. The ids MUST match the display
 * names the inbound handler reports as externalStatus ('Open'/'Closed' —
 * see inbound.ts's statusMap), since status mappings are keyed by that name.
 */
export async function fetchGitLabStatuses(): Promise<ExternalStatusItem[]> {
  return [
    { id: 'Open', name: 'Open' },
    { id: 'Closed', name: 'Closed' },
  ]
}
