/**
 * GitLab issue reads.
 */

import { ServiceUnavailableError } from '@/lib/shared/errors'
import { gitlabApiBase } from '@/integrations/gitlab/server/url'
import { gitlabFetch } from '@/integrations/gitlab/server/fetch'

export interface GitLabIssueState {
  state?: string
  updatedAt?: string
  projectId?: string
}

/**
 * Read an issue's current state from one project. Returns null when the issue
 * is not in that project (deleted or moved); other failures throw.
 */
export async function getGitLabIssueState(
  accessToken: string,
  instanceUrl: string | null | undefined,
  projectId: string,
  iid: string
): Promise<GitLabIssueState | null> {
  const response = await gitlabFetch(
    `${gitlabApiBase(instanceUrl)}/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(iid)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (response.status === 404) return null
  if (!response.ok) {
    throw new ServiceUnavailableError(
      'PROVIDER_REQUEST_FAILED',
      `Failed to read GitLab issue: HTTP ${response.status}`
    )
  }

  const data = (await response.json()) as {
    state?: unknown
    updated_at?: unknown
    project_id?: unknown
  }
  return {
    state: typeof data.state === 'string' ? data.state : undefined,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
    projectId:
      typeof data.project_id === 'number' || typeof data.project_id === 'string'
        ? String(data.project_id)
        : undefined,
  }
}
