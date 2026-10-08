/**
 * "Require SSO" for writers of an account's email address.
 *
 * An address at a verified domain that requires SSO belongs to that domain's
 * provider. Moving an account off one would let it sign in with an email link
 * or password instead of the provider. Moving one onto it would put the
 * account behind a provider it may not sign in with. Both are allowed only for
 * an account that already signs in through that provider: someone whose
 * provider released no email may add their address at its domain, and an
 * address there may be corrected to another one there.
 */
import type { UserId } from '@quackback/ids'
import { and, db, eq, account } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { SSO_MANAGED_EMAIL_MESSAGE } from '@/lib/shared/sso-managed-email'
import { ssoManagingProvider } from './auth-restrictions'

/** Identity providers and the ids registered right now, as sign-in reads them. */
export async function loadSsoDomains() {
  const { listIdentityProviders } =
    await import('@/lib/server/domains/settings/identity-providers.service')
  const { getRegisteredOidcProviderIds } = await import('./registered-providers')
  const providers = await listIdentityProviders()
  return { providers, registered: await getRegisteredOidcProviderIds(providers) }
}

/** Whether moving this account's address from `from` to `to` is refused. */
export async function isEmailMoveSsoBlocked(opts: {
  userId: UserId
  from: string | null
  to: string | null
}): Promise<boolean> {
  if (!opts.from && !opts.to) return false
  const { providers, registered } = await loadSsoDomains()
  const fromOwner = ssoManagingProvider(opts.from, providers, registered)
  const toOwner = ssoManagingProvider(opts.to, providers, registered)
  if (!fromOwner && !toOwner) return false
  // Off a managed address only to another address managed by the same
  // provider; onto one only through that provider.
  if (fromOwner && toOwner !== fromOwner) return true
  const owner = (toOwner ?? fromOwner)!
  const linked = await db.query.account.findFirst({
    where: and(eq(account.userId, opts.userId), eq(account.providerId, owner)),
    columns: { id: true },
  })
  return !linked
}

/** {@link isEmailMoveSsoBlocked}, refusing with the shared message. */
export async function assertEmailMoveAllowed(opts: {
  userId: UserId
  from: string | null
  to: string | null
}): Promise<void> {
  if (await isEmailMoveSsoBlocked(opts)) {
    throw new ValidationError('SSO_MANAGED', SSO_MANAGED_EMAIL_MESSAGE)
  }
}
