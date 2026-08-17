/**
 * Origins Better Auth will accept for CSRF / Origin checks.
 *
 * Pooled workspaces list every hostname on the registry record: system,
 * friendly platform, redirects, and ready custom hosts. The list is read
 * from the request scope, not snapshotted when the auth instance is first
 * built — a custom domain added after the first sign-in would otherwise
 * keep 403ing "Invalid origin" until auth_config_version happened to bump.
 *
 * Process-wide TRUSTED_ORIGINS is only for a single-workspace install.
 * Honouring it under pooled tenancy would trust one workspace's origin on
 * every other workspace in the process.
 */
import { config } from '@/lib/server/config'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

const WILDCARD_HOST_RE = /[*?]/

export function originsForWorkspaceHostnames(baseUrl: string, hostnames: string[]): string[] {
  let protocol = 'https:'
  let baseOrigin: string | null = null
  try {
    const parsed = new URL(baseUrl)
    protocol = parsed.protocol
    baseOrigin = parsed.origin
  } catch {
    baseOrigin = null
  }
  const origins = new Set<string>()
  if (baseOrigin) origins.add(baseOrigin)
  for (const raw of hostnames) {
    const host = raw.trim().toLowerCase().split(':')[0] ?? ''
    if (!host || host.includes('/') || WILDCARD_HOST_RE.test(host)) continue
    origins.add(`${protocol}//${host}`)
  }
  return [...origins]
}

export function workspaceAuthTrustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const workspace = getCurrentWorkspace()
  if (workspace) {
    return originsForWorkspaceHostnames(
      workspace.routing.baseUrl || config.baseUrl,
      workspace.routing.hostnames
    )
  }
  const extra = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...originsForWorkspaceHostnames(config.baseUrl, []), ...extra]
}
