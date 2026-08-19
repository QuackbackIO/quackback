import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const GITLAB_API = 'https://gitlab.com/api/v4'

/** Close the linked GitLab issue on cascading post delete. */
export async function closeGitLabIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const projectId = extractGitLabProjectId(ctx.externalUrl)
  if (!projectId) return { success: false, error: 'Cannot determine project from external URL' }

  const response = await fetch(
    `${GITLAB_API}/projects/${encodeURIComponent(projectId)}/issues/${ctx.externalId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state_event: 'close' }),
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
    }
  )

  const err = await handleErrorStatus(response, 'GitLab', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

function extractGitLabProjectId(url?: string | null): string | null {
  if (!url) return null
  const match = url.match(/gitlab\.com\/(.+?)\/-\/issues/)
  return match?.[1] ?? null
}
