/**
 * Inbound user-sync orchestrator.
 *
 * Handles incoming identify events from CDP and CRM integrations
 * (Segment, RudderStack, mParticle, etc.) and merges traits into
 * user.metadata based on defined UserAttributeDefinitions.
 *
 * Route: POST /api/integrations/:type/identify
 */

import { db, integrations, userAttributeDefinitions, user, eq, and } from '@/lib/server/db'
import { getIntegration } from './index'
import { decryptSecrets } from './encryption'
import type { UserAttributeType } from '@/lib/server/db'

/**
 * Handle an inbound user identify event from an integration.
 *
 * Flow:
 *   1. Look up the integration definition and verify it supports userSync.handleIdentify
 *   2. Fetch the active integration record
 *   3. Call the integration-specific handleIdentify — returns either a
 *      UserIdentifyPayload (proceed) or a Response (short-circuit)
 *   4. Merge matching traits into user.metadata
 */
export async function handleInboundIdentify(
  request: Request,
  integrationType: string
): Promise<Response> {
  const definition = getIntegration(integrationType)
  if (!definition?.userSync?.handleIdentify) {
    return new Response('Integration does not support user identify sync', { status: 404 })
  }

  const body = await request.text()

  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.integrationType, integrationType),
      eq(integrations.status, 'active')
    ),
  })
  if (!integration) {
    return new Response('Integration not configured or inactive', { status: 404 })
  }

  const config = (integration.config ?? {}) as Record<string, unknown>
  const secrets = integration.secrets ? decryptSecrets(integration.secrets) : {}

  const result = await definition.userSync.handleIdentify(request, body, config, secrets)

  // Integration returned a Response directly — honour it
  if (result instanceof Response) return result

  // We have a UserIdentifyPayload — merge traits into user.metadata
  const { email, traits } = result
  try {
    await mergeUserTraits(email, traits)
    console.log(
      `[UserSync] Merged ${Object.keys(traits).length} trait(s) for ${email} via ${integrationType}`
    )
  } catch (error) {
    console.error(`[UserSync] Failed to merge traits for ${email}:`, error)
    // Return 200 — we received the payload successfully, processing failure is internal
  }

  return new Response('OK', { status: 200 })
}

/**
 * Merge CDP/CRM traits into user.metadata, filtered through UserAttributeDefinitions.
 *
 * Only attributes that have a defined UserAttributeDefinition are written.
 * The definition's externalKey (if set) maps the external trait name to the
 * internal metadata key; otherwise the definition's own key is used.
 *
 * Values are coerced to match the attribute's declared type.
 *
 * Exported so callers (e.g. import scripts) can reuse the same logic.
 */
export async function mergeUserTraits(
  email: string,
  traits: Record<string, unknown>
): Promise<void> {
  if (Object.keys(traits).length === 0) return

  const attrDefs = await db.select().from(userAttributeDefinitions)
  if (attrDefs.length === 0) return

  // Build: external trait name → { internalKey, type }
  const traitMap = new Map<string, { internalKey: string; type: UserAttributeType }>()
  for (const def of attrDefs) {
    const lookupKey = def.externalKey ?? def.key
    traitMap.set(lookupKey, { internalKey: def.key, type: def.type as UserAttributeType })
  }

  // Build a partial metadata update from matching traits
  const update: Record<string, unknown> = {}
  for (const [traitKey, traitValue] of Object.entries(traits)) {
    const mapping = traitMap.get(traitKey)
    if (!mapping) continue // not a defined attribute — skip

    const coerced = coerceValue(traitValue, mapping.type)
    if (coerced !== undefined) {
      update[mapping.internalKey] = coerced
    }
  }

  if (Object.keys(update).length === 0) return

  const userRecord = await db.query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true, metadata: true },
  })
  if (!userRecord) {
    console.log(`[UserSync] No user found for email ${email}, skipping trait merge`)
    return
  }

  let existing: Record<string, unknown> = {}
  if (userRecord.metadata) {
    try {
      existing = JSON.parse(userRecord.metadata) as Record<string, unknown>
    } catch {
      // ignore malformed metadata
    }
  }

  await db
    .update(user)
    .set({ metadata: JSON.stringify({ ...existing, ...update }) })
    .where(eq(user.id, userRecord.id))
}

/**
 * Coerce an incoming CDP trait value to the declared attribute type.
 * Returns undefined if the value cannot be meaningfully coerced.
 */
function coerceValue(value: unknown, type: UserAttributeType): unknown {
  if (value === null || value === undefined) return undefined
  switch (type) {
    case 'string':
      return String(value)
    case 'number':
    case 'currency': {
      const n = Number(value)
      return isNaN(n) ? undefined : n
    }
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === '1') return true
      if (value === 'false' || value === '0') return false
      return undefined
    case 'date':
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value)
        return isNaN(d.getTime()) ? undefined : d.toISOString()
      }
      return undefined
    default:
      return undefined
  }
}
