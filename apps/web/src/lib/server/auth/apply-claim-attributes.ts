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
import { logger } from '@/lib/server/logger'
import { readSsoClaimsWithProvenance, type ClaimRead } from './read-sso-claims'

export { planClaimAttributeWrites }
export type { AttributeDefinition }

const log = logger.child({ component: 'claim-attributes' })

/**
 * Apply `claim_mapping.attributes` for the callback provider. Independent of
 * auto-create / role gates — identity resolution already ran.
 *
 * `readClaims`, when provided, is the shared per-callback reader so a
 * take-once stash is not drained by role provisioning first. Omitted, this
 * falls back to `readSsoClaimsWithProvenance` so unit tests that call the
 * writer directly keep passing.
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
  registeredOidcIds: Set<string>,
  readClaims?: () => Promise<ClaimRead>
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

  const { claims, fresh } = await (readClaims
    ? readClaims()
    : readSsoClaimsWithProvenance(userIdTyped, providerId))

  // Write from a fallback read, never clear on one. The stored ID token can
  // never carry a userinfo-only claim, so its absence there is not the IdP
  // withdrawing it — and a stash miss (overlapping callbacks for one subject,
  // TTL, eviction) must not turn syncOnSignIn into a delete.
  const syncSuppressed = !fresh && attributes.syncOnSignIn === true
  const mapping = syncSuppressed ? { ...attributes, syncOnSignIn: false } : attributes
  if (syncSuppressed) {
    log.info(
      { user_id: userId, provider_id: providerId },
      'claim attribute sync skipped: claims read from stored ID token, not this sign-in'
    )
  }

  let existing: Record<string, unknown> = {}
  if (owner.metadata) {
    try {
      existing = JSON.parse(owner.metadata) as Record<string, unknown>
    } catch {
      existing = {}
    }
  }

  const definitions = await db.select().from(userAttributeDefinitions)
  const debug = process.env.AUTH_HOOKS_DEBUG === '1'
  const { valid, removals, skips } = planClaimAttributeWrites({
    claims,
    mapping,
    existing,
    definitions: definitions.map((d) => ({ key: d.key, type: d.type })),
    explain: debug,
  })

  if (debug) {
    for (const skip of skips ?? []) {
      log.debug(
        { user_id: userId, provider_id: providerId, key: skip.key, reason: skip.reason },
        'claim attribute write skipped'
      )
    }
  }

  if (Object.keys(valid).length === 0 && removals.length === 0) return

  const next = mergeMetadata(owner.metadata, valid, removals)
  if (next === owner.metadata) return
  await db.update(userTable).set({ metadata: next }).where(eq(userTable.id, userIdTyped))
  log.info(
    {
      user_id: userId,
      provider_id: providerId,
      written: Object.keys(valid),
      removed: removals,
    },
    'claim attributes written'
  )
}
