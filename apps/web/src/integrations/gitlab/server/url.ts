/**
 * GitLab instance URL helpers.
 *
 * Platform credentials may include an optional `instanceUrl`. When it is
 * omitted, every GitLab call site uses gitlab.com — the historical default.
 * A provided value is reduced to its origin so a trailing slash or path
 * cannot change which host we talk to.
 */

export const GITLAB_COM_ORIGIN = 'https://gitlab.com'

export class GitLabInstanceUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitLabInstanceUrlError'
  }
}

/**
 * Normalize a GitLab instance URL to its origin.
 * Empty / missing values resolve to gitlab.com so existing connections
 * keep working. Rejects credentials, non-http(s) schemes, and unparseable
 * strings — the same class of unsafe URLs sibling integrations refuse.
 */
export function normalizeGitLabInstanceUrl(raw?: string | null): string {
  const trimmed = raw?.trim()
  if (!trimmed) return GITLAB_COM_ORIGIN

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new GitLabInstanceUrlError('GitLab instance URL must be a valid URL')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new GitLabInstanceUrlError('GitLab instance URL must be an http(s) URL')
  }
  if (parsed.username || parsed.password) {
    throw new GitLabInstanceUrlError('GitLab instance URL must not include credentials')
  }

  return parsed.origin
}

/** REST API root for the given instance (`{origin}/api/v4`). */
export function gitlabApiBase(instanceUrl?: string | null): string {
  return `${normalizeGitLabInstanceUrl(instanceUrl)}/api/v4`
}

/**
 * Project path from a GitLab issue web URL.
 * Accepts both `/{path}/-/issues/{iid}` (current) and `/{path}/issues/{iid}`.
 */
export function extractGitLabProjectPath(url?: string | null): string | null {
  if (!url) return null
  const match = url.match(/https?:\/\/[^/]+\/(.+?)\/(?:-\/)?issues(?:\/|$|\?)/)
  return match?.[1] ?? null
}
