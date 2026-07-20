import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

/** Transition the linked Jira issue to a terminal (done-category) status. */
export async function closeJiraIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const cloudId = ctx.integrationConfig.cloudId as string
  if (!cloudId) return { success: false, error: 'Missing Jira cloudId' }

  const baseUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`
  const headers = {
    Authorization: `Bearer ${ctx.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const transRes = await fetch(`${baseUrl}/issue/${ctx.externalId}/transitions`, {
    headers,
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })
  const transErr = await handleErrorStatus(transRes, 'Jira', 'closed')
  if (transErr) return transErr

  const transData = (await transRes.json()) as {
    transitions: Array<{ id: string; name: string; to: { statusCategory: { key: string } } }>
  }

  const terminal = transData.transitions.find((t) => t.to.statusCategory.key === 'done')
  if (!terminal) {
    return { success: false, error: 'No terminal transition found (Done/Closed)' }
  }

  const execRes = await fetch(`${baseUrl}/issue/${ctx.externalId}/transitions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transition: { id: terminal.id } }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  if (!execRes.ok) {
    return { success: false, error: `Jira transition failed: ${execRes.status}` }
  }
  return { success: true, action: 'closed' }
}
