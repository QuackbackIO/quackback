import type { ExternalStatusItem } from '@/lib/server/integrations/types'

/** Azure DevOps common work-item states — can be customized per project. */
export async function fetchAzureDevOpsStatuses(): Promise<ExternalStatusItem[]> {
  return [
    { id: 'New', name: 'New' },
    { id: 'Active', name: 'Active' },
    { id: 'Resolved', name: 'Resolved' },
    { id: 'Closed', name: 'Closed' },
  ]
}
