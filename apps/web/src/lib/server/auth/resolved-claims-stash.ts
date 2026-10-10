/**
 * Hands the resolver's freshly-validated claims, and its profile decisions, to
 * the callback after-hooks (role provisioning, attribute writes, profile
 * refresh).
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
 * missed. A miss means reading the stored token instead, and a profile
 * refresh that changes nothing for that sign-in.
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

/** What the resolver decided about the profile for one sign-in. */
export type ResolvedProfile = {
  /** The display name exactly as the provider sent it. Never synthesized. */
  name?: string
  /** The avatar URL the binder resolved from the mapped avatar claim. */
  image?: string
  /** Every name sign-up could have generated for this account. */
  generatedNames: string[]
}

/** One sign-in as the resolver saw it. */
export type ResolvedSignIn = {
  claims: Record<string, unknown>
  profile: ResolvedProfile
}

type Entry = ResolvedSignIn & { ts: number }

const entries = new WorkspaceKeyedCache<Entry>(4_096)

function key(providerId: string, accountId: string): string {
  // NUL separator written as an escape, never as a raw byte: a literal NUL
  // makes git call this a binary file, so the whole module drops out of every
  // diff -- which is the last thing an auth file should do.
  return `${providerId}\u0000${accountId}`
}

/** Record the sign-in that just resolved for this identity. */
export function stashResolvedClaims(
  providerId: string,
  accountId: string,
  resolved: ResolvedSignIn
): void {
  const k = key(providerId, accountId)
  entries.set(k, { ...resolved, ts: Date.now() })
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

/** Take the stashed sign-in, if this identity resolved in this request. */
export function takeResolvedClaims(providerId: string, accountId: string): ResolvedSignIn | null {
  const k = key(providerId, accountId)
  const held = entries.get(k)
  if (!held) return null
  entries.delete(k)
  if (Date.now() - held.ts >= TTL_MS) return null
  return { claims: held.claims, profile: held.profile }
}
