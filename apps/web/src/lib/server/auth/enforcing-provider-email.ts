/**
 * A domain's enforcing provider vouches for an existing account at its domain.
 *
 * "Require SSO" rests on one premise: for an address at the domain, the
 * domain's own provider is the authority, and inbox control is not. An
 * existing local account for such an address that was never verified (made
 * before the domain required SSO, or by an import) is stuck: Better Auth will
 * not link a provider to an unverified account, and every other way to verify
 * it (email link, code, password reset) is refused for the address. So when
 * that provider signs someone in with the address, its sign-in verifies the
 * account, and Better Auth then links it as it would any verified one.
 *
 * The account's sessions end first: whoever held it before the provider
 * vouched for it does not keep it.
 */
import { and, db, eq, sql, account, session, user } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import type { ProviderWithDomains } from './provider-ids'
import { ssoManagingProvider } from './auth-restrictions'

const log = logger.child({ component: 'enforcing-provider-email' })

export async function vouchForEnforcedAddress(opts: {
  registrationId: string
  email: string
  providers: readonly ProviderWithDomains[]
}): Promise<void> {
  const email = opts.email.trim().toLowerCase()
  // Only the provider that enforces the address's domain, which is registered
  // by definition while it is handling this sign-in.
  const owner = ssoManagingProvider(email, opts.providers, new Set([opts.registrationId]))
  if (owner !== opts.registrationId) return

  const existing = await db.query.user.findFirst({
    where: sql`LOWER(${user.email}) = ${email}`,
    columns: { id: true, emailVerified: true },
  })
  if (!existing || existing.emailVerified) return
  const linked = await db.query.account.findFirst({
    where: and(eq(account.userId, existing.id), eq(account.providerId, owner)),
    columns: { id: true },
  })
  if (linked) return

  const vouched = await db.transaction(async (tx) => {
    const updated = await tx
      .update(user)
      .set({ emailVerified: true })
      .where(and(eq(user.id, existing.id), eq(user.emailVerified, false)))
      .returning({ id: user.id })
    if (updated.length === 0) return false
    await tx.delete(session).where(eq(session.userId, existing.id))
    return true
  })
  if (!vouched) return

  log.info(
    { user_id: existing.id, provider_id: owner },
    'enforcing provider verified an existing account at its domain'
  )
  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  await recordAuditEvent({
    event: 'user.email_verified.asserted',
    actor: {},
    target: { type: 'user', id: existing.id },
    before: { emailVerified: false },
    after: { emailVerified: true },
    metadata: { source: 'enforcing_provider_sign_in', providerId: owner },
  })
}
