/**
 * A domain's enforcing provider vouches for the account it signs in to.
 *
 * "Require SSO" rests on one premise: for an address at the domain, the
 * domain's own provider is the authority, and inbox control is not. An account
 * for such an address can be unverified (made before the domain required SSO,
 * by an import, or after an admin corrected the address), and then it is stuck:
 * Better Auth will not link a provider to an unverified account, and every
 * other way to verify it (email link, code, password reset) is refused for the
 * address. So when that provider signs someone in with the address, its
 * sign-in verifies the account the sign-in will land on:
 *
 * - already linked to this provider identity: that account, when its address
 *   is the one asserted;
 * - not linked yet: the account holding the address, unless another identity
 *   of this provider already owns it. Better Auth then links it as it would
 *   any verified account. Its sessions end first: whoever held it before the
 *   provider vouched for it does not keep it.
 *
 * The write only lands while the account still holds the asserted address.
 */
import { and, db, eq, sql, account, session, user } from '@/lib/server/db'
import type { UserId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import type { ProviderWithDomains } from './provider-ids'
import { ssoManagingProvider } from './auth-restrictions'

const log = logger.child({ component: 'enforcing-provider-email' })

/** The account this sign-in lands on, if the provider may vouch for it. */
async function accountToVouch(
  owner: string,
  accountId: string,
  email: string
): Promise<{ userId: UserId; endSessions: boolean } | null> {
  const signedInTo = await db.query.account.findFirst({
    where: and(eq(account.providerId, owner), eq(account.accountId, accountId)),
    columns: { userId: true },
  })
  if (signedInTo) return { userId: signedInTo.userId as UserId, endSessions: false }

  const holder = await db.query.user.findFirst({
    where: sql`LOWER(${user.email}) = ${email}`,
    columns: { id: true },
  })
  if (!holder) return null
  const ownedByAnotherIdentity = await db.query.account.findFirst({
    where: and(eq(account.userId, holder.id), eq(account.providerId, owner)),
    columns: { id: true },
  })
  if (ownedByAnotherIdentity) return null
  return { userId: holder.id as UserId, endSessions: true }
}

export async function vouchForEnforcedAddress(opts: {
  registrationId: string
  /** The provider's subject for this person (Better Auth's `accountId`). */
  accountId: string
  email: string
  providers: readonly ProviderWithDomains[]
}): Promise<void> {
  const email = opts.email.trim().toLowerCase()
  // Only the provider that enforces the address's domain, which is registered
  // by definition while it is handling this sign-in.
  const owner = ssoManagingProvider(email, opts.providers, new Set([opts.registrationId]))
  if (owner !== opts.registrationId) return

  const found = await accountToVouch(owner, opts.accountId, email)
  if (!found) return
  const { userId: target, endSessions } = found

  const vouched = await db.transaction(async (tx) => {
    const updated = await tx
      .update(user)
      .set({ emailVerified: true })
      .where(
        and(
          eq(user.id, target),
          eq(user.emailVerified, false),
          sql`LOWER(${user.email}) = ${email}`
        )
      )
      .returning({ id: user.id })
    if (updated.length === 0) return false
    if (endSessions) await tx.delete(session).where(eq(session.userId, target))
    return true
  })
  if (!vouched) return

  log.info(
    { user_id: target, provider_id: owner, linked: !endSessions },
    'enforcing provider verified the account it signs in to'
  )
  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  await recordAuditEvent({
    event: 'user.email_verified.asserted',
    actor: {},
    target: { type: 'user', id: target },
    before: { emailVerified: false },
    after: { emailVerified: true },
    metadata: { source: 'enforcing_provider_sign_in', providerId: owner },
  })
}
