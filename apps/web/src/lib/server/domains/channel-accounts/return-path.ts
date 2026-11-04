/**
 * The return path a new sending domain is set up with when the operator
 * serves bounce records under a domain of its own (`EMAIL_RETURN_PATH_DOMAIN`).
 *
 * The provider needs an MX to its feedback host and an SPF TXT at the MAIL FROM
 * name. With the setting, the operator publishes both once, as wildcards under
 * its own domain, and the customer's MAIL FROM name becomes one CNAME to
 * `<workspace label>.<operator domain>`; the provider follows the CNAME and
 * finds both. Unset, the customer publishes the MX and the TXT themselves.
 *
 * The label is per workspace rather than shared, so one workspace's bounces can
 * be told apart and routed on their own later. It is derived from the
 * workspace key (the id the workspace is registered under), never from a name
 * a customer chose: `ws-` and the first 24 hex characters of a SHA-256 of the
 * key, the same derivation as the workspace's own system hostname label, so an
 * operator reading a bounce sees a label it already knows. A key never changes,
 * so neither does the label, and records published under it keep resolving.
 */
import { createHash } from 'node:crypto'
import { sesReturnPathDomain } from '@quackback/email/ses-identity'
import { SINGLE_WORKSPACE_KEY } from '@/lib/server/workspaces/after-commit'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

type EnvLike = Record<string, string | undefined>

/** The DNS label for a workspace key: lowercase hex under a fixed prefix, 27 characters. */
export function returnPathLabel(workspaceKey: string): string {
  const digest = createHash('sha256')
    .update(`quackback-workspace-identity-v1:${workspaceKey}`)
    .digest('hex')
  return `ws-${digest.slice(0, 24)}`
}

/**
 * The key of the workspace this process is acting for: the scoped one, the
 * instance id a single-workspace process is given, or the single workspace.
 * Null on a pooled process outside any scope, where no workspace is known.
 */
function currentWorkspaceKey(env: EnvLike): string | null {
  const scoped = getCurrentWorkspace()?.workspaceKey
  if (scoped) return scoped
  const instance = env.QUACKBACK_INSTANCE_ID?.trim()
  if (instance) return instance
  return isPooledTenancy(env) ? null : SINGLE_WORKSPACE_KEY
}

/**
 * The per-workspace label for the workspace this process is acting for, or
 * null on a pooled process outside any scope. Also the workspace's mail
 * provider tenant name (see `ses-tenant-state.ts`), so an operator reading
 * either sees the same label.
 */
export function currentWorkspaceLabel(env: EnvLike = process.env): string | null {
  const key = currentWorkspaceKey(env)
  return key ? returnPathLabel(key) : null
}

/**
 * The CNAME target for a new domain's return path, or null when the domain
 * publishes the MX and TXT itself.
 */
export function returnPathTarget(env: EnvLike = process.env): string | null {
  const domain = sesReturnPathDomain(env)
  if (!domain) return null
  const label = currentWorkspaceLabel(env)
  return label ? `${label}.${domain}` : null
}
