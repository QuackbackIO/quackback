/**
 * Copy IdP claims into defined user attributes at sign-in.
 *
 * Only keys that exist on `user_attribute_definitions` are written. Values
 * are coerced by type. overrideExisting defaults off. syncOnSignIn can clear
 * a value when the claim disappears.
 */

import { claimMappingFor } from '@/lib/shared/oidc-claim-mapping'
import {
  planClaimAttributeWrites,
  type AttributeDefinition,
} from '@/lib/shared/plan-claim-attribute-writes'

export { planClaimAttributeWrites }
export type { AttributeDefinition }

/**
 * Apply `claim_mapping.attributes` for the callback provider. Independent of
 * auto-create / role gates — identity resolution already ran.
 */
export async function applyClaimAttributesAfter(
  ctx: {
    path?: string
    params?: Record<string, unknown>
    context?: {
      newSession?: { user?: { id?: string } } | null
    }
  },
  providers: Awaited<
    ReturnType<
      typeof import('@/lib/server/domains/settings/identity-providers.service').listIdentityProviders
    >
  >,
  registeredOidcIds: Set<string>
): Promise<void> {
  if (ctx.path !== '/oauth2/callback/:providerId') return
  const providerId = ctx.params?.providerId
  const { isRegisteredOidcProvider } = await import('./provider-ids')
  if (typeof providerId !== 'string' || !isRegisteredOidcProvider(providerId, registeredOidcIds))
    return

  const userId = ctx.context?.newSession?.user?.id
  if (typeof userId !== 'string') return

  const provider = providers.find((p) => p.registrationId === providerId)
  if (!provider) return
  const attributes = claimMappingFor(provider.claimMapping).attributes
  if (!attributes?.map?.length) return

  type UserId = `user_${string}`
  const userIdTyped = userId as UserId
  const { db, user: userTable, userAttributeDefinitions, eq } = await import('@/lib/server/db')
  const { mergeMetadata } = await import('@/lib/server/domains/users/user.attributes')

  const owner = await db.query.user.findFirst({
    where: eq(userTable.id, userIdTyped),
    columns: { metadata: true },
  })
  if (!owner) return

  const claims = await (async () => {
    const { db: dbInner, account, and, eq: eqInner, desc } = await import('@/lib/server/db')
    const { takeResolvedClaims } = await import('./resolved-claims-stash')
    const row = await dbInner.query.account.findFirst({
      where: and(eqInner(account.userId, userIdTyped), eqInner(account.providerId, providerId)),
      columns: { idToken: true, accountId: true },
      orderBy: desc(account.createdAt),
    })
    if (row?.accountId) {
      const fresh = takeResolvedClaims(providerId, row.accountId)
      if (fresh) return fresh
    }
    if (!row?.idToken) return {}
    const parts = row.idToken.split('.')
    if (parts.length !== 3) return {}
    try {
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<
        string,
        unknown
      >
    } catch {
      return {}
    }
  })()

  let existing: Record<string, unknown> = {}
  if (owner.metadata) {
    try {
      existing = JSON.parse(owner.metadata) as Record<string, unknown>
    } catch {
      existing = {}
    }
  }

  const definitions = await db.select().from(userAttributeDefinitions)
  const { valid, removals } = planClaimAttributeWrites({
    claims,
    mapping: attributes,
    existing,
    definitions: definitions.map((d) => ({ key: d.key, type: d.type })),
  })
  if (Object.keys(valid).length === 0 && removals.length === 0) return

  const next = mergeMetadata(owner.metadata, valid, removals)
  if (next === owner.metadata) return
  await db.update(userTable).set({ metadata: next }).where(eq(userTable.id, userIdTyped))
}
