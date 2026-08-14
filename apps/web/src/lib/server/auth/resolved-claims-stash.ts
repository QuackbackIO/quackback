/**
 * Hands the resolver's freshly-validated claims to the role-provisioning hook.
 *
 * Role assignment used to re-read `account.id_token` from the database.
 * Providers that resolve identity from userinfo or an access token have no
 * ID token to read, so they silently fell back to the default role.
 *
 * The two run in the same request but share no context: resolution happens in
 * the plugin's `getUserInfo`, provisioning in an after-hook. So the claims are
 * stashed on the way past and drained on the way through.
 *
 * Same shape as the magic-link and OTP stashes: a short TTL, take-once
 * semantics, and a fallback path that still works if the entry is missed.
 */

const TTL_MS = 30_000

type Entry = { claims: Record<string, unknown>; ts: number }

const entries = new Map<string, Entry>()

function key(providerId: string, accountId: string): string {
  // NUL separator written as an escape, never as a raw byte: a literal NUL
  // makes git call this a binary file.
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
  setTimeout(() => {
    const held = entries.get(k)
    if (held && Date.now() - held.ts >= TTL_MS) entries.delete(k)
  }, TTL_MS).unref?.()
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
