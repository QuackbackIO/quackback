import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'
import {
  extractGitLabProjectPath,
  gitlabApiBase,
  normalizeGitLabInstanceUrl,
} from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'

/** Close the linked GitLab issue on cascading post delete. */
export async function closeGitLabIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const projectId = extractGitLabProjectPath(ctx.externalUrl)
  if (!projectId) return { success: false, error: 'Cannot determine project from external URL' }

  const response = await gitlabFetch(
    `${gitlabApiBase(instanceUrlFrom(ctx))}/projects/${encodeURIComponent(projectId)}/issues/${ctx.externalId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state_event: 'close' }),
      timeoutMs: ARCHIVE_TIMEOUT_MS,
    }
  )

  const err = await handleErrorStatus(response, 'GitLab', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}

function instanceUrlFrom(ctx: ArchiveContext): string {
  const stored = ctx.integrationConfig.instanceUrl
  if (typeof stored === 'string' && stored.trim()) {
    return normalizeGitLabInstanceUrl(stored)
  }
  if (ctx.externalUrl) {
    try {
      return new URL(ctx.externalUrl).origin
    } catch {
      // fall through to gitlab.com default
    }
  }
  return normalizeGitLabInstanceUrl(null)
}
