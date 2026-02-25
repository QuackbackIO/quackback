/**
 * Inbound user-sync orchestrator.
 *
 * Handles incoming identify events from CDP and CRM integrations
 * (Segment, RudderStack, mParticle, etc.) and merges user attributes into
 * user.metadata based on defined UserAttributeDefinitions.
 *
 * Route: POST /api/integrations/:type/identify
 */

import { db, integrations, userAttributeDefinitions, user, eq, and } from '@/lib/server/db'
import { getIntegration } from './index'
import { decryptSecrets } from './encryption'
import { coerceAttributeValue } from '@/lib/server/domains/user-attributes/coerce'
import type { UserAttributeType } from '@/lib/server/db'
import type { UserIdentifyPayload } from './user-sync-types'

/**
 * Handle an inbound user identify event from an integration.
 *
 * Flow:
 *   1. Look up the integration definition and verify it supports userSync.handleIdentify
 *   2. Fetch the active integration record
 *   3. Call the integration-specific handleIdentify — returns either a
 *      UserIdentifyPayload (proceed) or a Response (short-circuit)
 *   4. Merge matching attributes into user.metadata
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

  // We have a UserIdentifyPayload — merge attributes into user.metadata
  const { email, externalUserId } = result
  const attributes = normalizeIdentifyAttributes(result)
  try {
    // Merge user attributes (filtered through definitions) and raw system fields
    // in a single call to avoid TOCTOU race on the metadata column
    const rawFields = externalUserId ? { _externalUserId: externalUserId } : {}
    await mergeUserAttributes(email, attributes, rawFields)
    console.log(
      `[UserSync] Merged ${Object.keys(attributes).length} attribute(s) for ${email} via ${integrationType}`
    )
  } catch (error) {
    console.error(`[UserSync] Failed to merge attributes for ${email}:`, error)
    // Return 200 — we received the payload successfully, processing failure is internal
  }

  return new Response('OK', { status: 200 })
}

function normalizeIdentifyAttributes(result: UserIdentifyPayload): Record<string, unknown> {
  const payload = result as { attributes?: unknown; traits?: unknown }
  if (isRecord(payload.attributes)) return payload.attributes
  if (isRecord(payload.traits)) return payload.traits
  return {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge CDP/CRM attributes into user.metadata, filtered through UserAttributeDefinitions.
 *
 * Only attributes that have a defined UserAttributeDefinition are written.
 * The definition's externalKey (if set) maps the external attribute name to the
 * internal metadata key; otherwise the definition's own key is used.
 *
 * Values are coerced to match the attribute's declared type.
 *
 * Optional `rawFields` are written directly to metadata without going through
 * attribute definition validation (used for system fields like _externalUserId).
 * Both are applied in a single read-modify-write to avoid TOCTOU races.
 *
 * Exported so callers (e.g. import scripts) can reuse the same logic.
 */
export async function mergeUserAttributes(
  email: string,
  attributes: Record<string, unknown>,
  rawFields: Record<string, unknown> = {}
): Promise<void> {
  const hasAttributes = Object.keys(attributes).length > 0
  const hasRawFields = Object.keys(rawFields).length > 0
  if (!hasAttributes && !hasRawFields) return

  // Build a partial metadata update from matching attribute definitions
  const update: Record<string, unknown> = {}

  if (hasAttributes) {
    const attrDefs = await db.select().from(userAttributeDefinitions)

    if (attrDefs.length > 0) {
      // Build: external attribute name → { internalKey, type }
      const attrMap = new Map<string, { internalKey: string; type: UserAttributeType }>()
      for (const def of attrDefs) {
        const lookupKey = def.externalKey ?? def.key
        attrMap.set(lookupKey, { internalKey: def.key, type: def.type as UserAttributeType })
      }

      for (const [key, value] of Object.entries(attributes)) {
        const mapping = attrMap.get(key)
        if (!mapping) continue // not a defined attribute — skip

        const coerced = coerceAttributeValue(value, mapping.type)
        if (coerced !== undefined) {
          update[mapping.internalKey] = coerced
        }
      }
    }
  }

  // Merge raw fields (system fields bypass attribute definitions)
  Object.assign(update, rawFields)

  if (Object.keys(update).length === 0) return

  const userRecord = await db.query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true, metadata: true },
  })
  if (!userRecord) {
    console.log(`[UserSync] No user found for email ${email}, skipping attribute merge`)
    return
  }

  const existing = parseMetadata(userRecord.metadata)

  await db
    .update(user)
    .set({ metadata: JSON.stringify({ ...existing, ...update }) })
    .where(eq(user.id, userRecord.id))
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
