import { createIntl } from 'react-intl'
import { createId, type PrincipalId } from '@quackback/ids'
import {
  db,
  principal,
  user,
  session,
  verification,
  conversations,
  eq,
  and,
  gt,
  desc,
  type Principal,
} from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import { loadMessages, type SupportedLocale } from '@/lib/shared/i18n'
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'
import { createPrincipal } from '@/lib/server/domains/principals/principal.factory'
import {
  TEST_CUSTOMER_SESSION_PREFIX,
  TEST_CUSTOMER_VERIFICATION_PREFIX,
} from '@/lib/shared/test-customer'

/** The owner row serializes creation; the unique index also enforces ownership. */
export async function getOrCreateTestCustomer(
  ownerPrincipalId: PrincipalId,
  locale: SupportedLocale
): Promise<Principal> {
  const intl = createIntl({ locale, messages: await loadMessages(locale) })
  const name = intl.formatMessage({
    id: 'onboarding.test.customer',
    defaultMessage: 'Test customer',
  })
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select()
      .from(principal)
      .where(eq(principal.id, ownerPrincipalId))
      .for('update')
    if (!owner?.userId || owner.type !== 'user' || !isTeamMember(owner.role))
      throw new Error('A team member must own the test customer')
    const existing = await tx.query.principal.findFirst({
      where: eq(principal.testOwnerPrincipalId, ownerPrincipalId),
    })
    if (existing) return existing
    const profile = await tx.query.user.findFirst({
      where: eq(user.id, owner.userId),
      columns: { email: true },
    })
    if (!profile) throw new Error('Team member account is unavailable')
    const id = createId('user')
    await tx.insert(user).values({
      id,
      name,
      email: `test-${id}@${ANON_EMAIL_DOMAIN}`,
      emailVerified: false,
      isAnonymous: true,
      metadata: JSON.stringify({ onboarding: { testOwnerPrincipalId: ownerPrincipalId } }),
    })
    return createPrincipal(
      {
        userId: id,
        type: 'anonymous',
        role: 'user',
        displayName: name,
        contactEmail: profile.email,
        testOwnerPrincipalId: ownerPrincipalId,
      },
      tx
    )
  })
}

const TEST_TOKEN_TTL_MS = 10 * 60_000
const TEST_SESSION_TTL_MS = 24 * 60 * 60_000

/** Use the existing one-time-token storage shape without any cookie-setting hooks. */
export async function mintTestCustomerToken(
  ownerPrincipalId: PrincipalId,
  locale: SupportedLocale
): Promise<{ token: string; expiresAt: string }> {
  const customer = await getOrCreateTestCustomer(ownerPrincipalId, locale)
  const now = new Date(),
    expiresAt = new Date(now.getTime() + TEST_TOKEN_TTL_MS)
  const token = `customer-${crypto.randomUUID()}`
  const bearerToken = `${TEST_CUSTOMER_SESSION_PREFIX}${crypto.randomUUID()}`
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ testOwnerPrincipalId: principal.testOwnerPrincipalId })
      .from(principal)
      .where(eq(principal.id, customer.id))
      .for('update')
    if (!current?.testOwnerPrincipalId) throw new Error('Test customer owner is unavailable')
    await tx.insert(session).values({
      id: crypto.randomUUID(),
      token: bearerToken,
      userId: customer.userId!,
      scope: 'widget',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + TEST_SESSION_TTL_MS),
    })
    await tx.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: `${TEST_CUSTOMER_VERIFICATION_PREFIX}${token}`,
      value: bearerToken,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
  })
  return { token, expiresAt: expiresAt.toISOString() }
}

/** A row lock consumes the token once; this path never sets a browser cookie. */
export async function consumeTestCustomerToken(token: string) {
  if (!token.startsWith('customer-') || token.length > 100) return null
  return db.transaction(async (tx) => {
    const [proof] = await tx
      .select()
      .from(verification)
      .where(
        and(
          eq(verification.identifier, `${TEST_CUSTOMER_VERIFICATION_PREFIX}${token}`),
          gt(verification.expiresAt, new Date())
        )
      )
      .for('update')
    if (!proof) return null
    const activeSession = await tx.query.session.findFirst({
      where: and(
        eq(session.token, proof.value),
        eq(session.scope, 'widget'),
        gt(session.expiresAt, new Date())
      ),
      with: { user: true },
    })
    if (!activeSession?.user) return null
    const customer = await tx.query.principal.findFirst({
      where: eq(principal.userId, activeSession.userId),
    })
    if (!customer?.testOwnerPrincipalId || customer.type !== 'anonymous') return null
    await tx.delete(verification).where(eq(verification.id, proof.id))
    return {
      bearerToken: activeSession.token,
      principal: customer,
      user: { id: activeSession.userId, name: activeSession.user.name, email: '', avatarUrl: null },
    }
  })
}

/** The owner's most recently active test conversation, if any. */
export async function latestTestConversationId(ownerPrincipalId: PrincipalId) {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .where(eq(principal.testOwnerPrincipalId, ownerPrincipalId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1)
  return row?.id ?? null
}
