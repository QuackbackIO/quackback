import type { ExternalStatusItem } from '@/lib/server/integrations/types'

/** GitHub issues have exactly two states; the mapping UI shows the fixed pair. */
export async function fetchGitHubStatuses(): Promise<ExternalStatusItem[]> {
  return [
    { id: 'Open', name: 'Open' },
    { id: 'Closed', name: 'Closed' },
  ]
}
