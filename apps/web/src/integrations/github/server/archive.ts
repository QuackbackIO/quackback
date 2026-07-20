import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const GITHUB_API = 'https://api.github.com'

/** Close the linked GitHub issue on cascading post delete. */
export async function closeGitHubIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const ownerRepo = extractGitHubOwnerRepo(ctx.externalUrl)
  if (!ownerRepo) return { success: false, error: 'Cannot determine repo from external URL' }

  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${ctx.externalId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quackback',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ state: 'closed' }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  if (response.status === 422) {
    response.body?.cancel()
    return { success: true, action: 'closed' } // already closed
  }
  const err = await handleErrorStatus(response, 'GitHub', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

function extractGitHubOwnerRepo(url?: string | null): string | null {
  if (!url) return null
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues/)
  return match?.[1] ?? null
}
