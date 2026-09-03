/**
 * Hands the resolver's freshly-validated claims to the role-provisioning hook.
 *
 * Role assignment re-reads `account.id_token` from the database, which has two
 * problems the resolver already solved. Providers that resolve identity from
 * userinfo or an access token have no ID token to read, so they silently fall
 * back to the default role however their claims are mapped. And the stored
 * token is whatever was last persisted, which is not necessarily what just
 * authenticated.
 *
 * The two run in the same request but share no context: resolution happens in
 * the plugin's `getUserInfo`, provisioning in an after-hook, with no channel
 * between them. So the claims are stashed on the way past and drained on the
 * way through, keyed by the provider and the account identity they belong to.
 *
 * Same shape as the magic-link and OTP stashes in the auth config: a short TTL,
 * take-once semantics, and a fallback path that still works if the entry is
 * missed. Nothing depends on the stash hitting — a miss just means the old
 * behaviour of reading the stored token.
 */

/**
 * ## Why the stash is keyed by workspace
 *
 * Not on SAAS-HOSTING-STACK.md §4.1's list, and it is the same hazard as the
 * entry heading it. The key is `providerId + accountId`, and neither half is
 * unique across workspaces: `google` is `google` everywhere, and the account id
 * is the IdP's subject, the same string for the same human in every workspace
 * they belong to. So one person signing into two workspaces at once has the
 * second sign-in drain claims resolved against the first, and those claims are
 * the input to role provisioning. Cross-workspace claim injection into role
 * assignment, and silent: the role mapping runs normally, just against another
 * workspace's `groups`.
 */
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { getWorkspaceScope, runWithWorkspaceScope } from '@/lib/server/workspaces/workspace-context'

const TTL_MS = 30_000

type Entry = { claims: Record<string, unknown>; ts: number }

const entries = new WorkspaceKeyedCache<Entry>(4_096)

function key(providerId: string, accountId: string): string {
  // NUL separator written as an escape, never as a raw byte: a literal NUL
  // makes git call this a binary file, so the whole module drops out of every
  // diff -- which is the last thing an auth file should do.
  return `${providerId}\u0000${accountId}`
}

/** Record the claims that just resolved for this identity. */
export function stashResolvedClaims(
  providerId: string,
  accountId: string,
  claims: Record<string, unknown>
): void {
  const k = key(providerId, accountId)
  entries.set(k, { claims, ts: Date.now() })
  // Self-cleaning, so a sign-in that never reaches provisioning (blocked by
  // policy, say) cannot leave claims resident.
  //
  // The sweep re-enters the scope that armed it. A timer callback runs with no
  // ambient scope, where every workspace-keyed read resolves to the single-workspace
  // namespace, so an unscoped sweep would miss the entry it was armed for and
  // delete an unrelated one. Same reasoning as the magic-link stash's sweep.
  const scope = getWorkspaceScope()
  const sweep = () => {
    const held = entries.get(k)
    if (held && Date.now() - held.ts >= TTL_MS) entries.delete(k)
  }
  setTimeout(() => (scope ? runWithWorkspaceScope(scope, sweep) : sweep()), TTL_MS).unref?.()
}

/** Take the stashed claims, if this identity resolved in this request. */
export function takeResolvedClaims(
  providerId: string,
  accountId: string
): Record<string, unknown> | null {
  const k = key(providerId, accountId)
  const held = entries.get(k)
  if (!held) return null
  entries.delete(k)
  if (Date.now() - held.ts >= TTL_MS) return null
  return held.claims
}

/**
 * Read the stashed claims WITHOUT consuming them, so another after-hook that
 * takes them (role provisioning) still gets its copy. Same TTL rule as
 * {@link takeResolvedClaims}.
 */
export function peekResolvedClaims(
  providerId: string,
  accountId: string
): Record<string, unknown> | null {
  const held = entries.get(key(providerId, accountId))
  if (!held || Date.now() - held.ts >= TTL_MS) return null
  return held.claims
}
