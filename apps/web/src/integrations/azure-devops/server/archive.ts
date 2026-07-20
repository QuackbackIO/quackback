import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

/** Set the linked Azure DevOps work item to Closed on cascading post delete. */
export async function closeAzureDevOpsWorkItem(ctx: ArchiveContext): Promise<ArchiveResult> {
  const orgName = ctx.integrationConfig.organizationName as string
  if (!orgName) return { success: false, error: 'Missing Azure DevOps organizationName' }

  const encoded = Buffer.from(`:${ctx.accessToken}`).toString('base64')
  const orgUrl =
    (ctx.integrationConfig.organizationUrl as string) || `https://dev.azure.com/${orgName}`

  const response = await fetch(`${orgUrl}/_apis/wit/workitems/${ctx.externalId}?api-version=7.1`, {
    method: 'PATCH',
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json-patch+json',
      Accept: 'application/json',
    },
    body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: 'Closed' }]),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Azure DevOps', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}
