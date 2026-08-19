/**
 * API Key Service - Business logic for API key operations
 *
 * Handles creation, validation, rotation, and revocation of API keys
 * for public API authentication.
 */

import { db, apiKeys, principal, eq, and, isNull } from '@/lib/server/db'
import { emit } from '@/lib/server/events/emit'
import { apiKeyCreated, apiKeyDeleted } from '@/lib/server/events/catalogue'
import type { PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isAdmin } from '@/lib/shared/roles'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.service'
import {
  setPrincipalRole,
  updatePrincipalFields,
  syncPrincipalProfileById,
} from '@/lib/server/domains/principals/principal.factory'
import {
  API_KEY_SCOPES,
  EMPTY_SCOPES_MESSAGE,
  orderScopes,
  parseApiKeyScopes,
  parseScopesJson,
} from './api-key-scopes'
import type { ApiKey, ApiKeyId, CreateApiKeyInput, CreateApiKeyResult } from './api-key.types'
export type { ApiKey, ApiKeyId, CreateApiKeyInput, CreateApiKeyResult }

/** API key prefix */
const API_KEY_PREFIX = 'qb_'

/** Length of the random part of the key (in bytes, will be hex encoded) */
const KEY_RANDOM_BYTES = 24 // 48 hex chars

type ApiKeyRow = typeof apiKeys.$inferSelect

/** Map a database row to the public ApiKey shape (strips keyHash, parses scopes). */
function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdById: row.createdById,
    principalId: row.principalId,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    scopes: parseApiKeyScopes(row.scopes),
  }
}

/**
 * Validate + normalize the scopes for a new key. Undefined/null means a legacy
 * full-authority key (stored NULL). A provided list must be non-empty and drawn
 * from the vocabulary; it is deduped and stored in vocabulary order.
 */
function normalizeScopesInput(scopes: CreateApiKeyInput['scopes']): string | null {
  if (scopes === undefined || scopes === null) return null
  const unknown = scopes.filter((s) => !API_KEY_SCOPES.includes(s))
  if (unknown.length > 0) {
    throw new ValidationError('VALIDATION_ERROR', `Unknown API key scope(s): ${unknown.join(', ')}`)
  }
  const ordered = orderScopes(scopes)
  if (ordered.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', EMPTY_SCOPES_MESSAGE)
  }
  return JSON.stringify(ordered)
}

/**
 * Generate a new API key
 *
 * Format: qb_<48 hex chars>
 * Example: qb_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4
 */
function generateApiKey(): string {
  const randomPart = randomBytes(KEY_RANDOM_BYTES).toString('hex')
  return `${API_KEY_PREFIX}${randomPart}`
}

/**
 * Hash an API key for storage
 *
 * Uses SHA-256 to create a one-way hash of the key
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Extract the prefix from an API key for identification
 *
 * Returns the first 12 characters (e.g., "qb_a1b2c3d4")
 */
function getKeyPrefix(key: string): string {
  return key.substring(0, 12)
}

/**
 * Create a new API key
 */
export async function createApiKey(
  input: CreateApiKeyInput,
  createdById: PrincipalId
): Promise<CreateApiKeyResult> {
  // Validate input
  if (!input.name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name is required')
  }
  if (input.name.length > 255) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name must be 255 characters or less')
  }

  const storedScopes = normalizeScopesInput(input.scopes)

  // Generate the key
  const plainTextKey = generateApiKey()
  const keyHash = hashApiKey(plainTextKey)
  const keyPrefix = getKeyPrefix(plainTextKey)

  // Look up creator's role for the service principal
  const creator = await db.query.principal.findFirst({
    where: eq(principal.id, createdById),
    columns: { role: true },
  })
  const role = (isAdmin(creator?.role) ? 'admin' : 'member') as 'admin' | 'member'

  // Create service principal for this API key
  const servicePrincipal = await createServicePrincipal({
    role,
    displayName: input.name.trim(),
    serviceMetadata: { kind: 'api_key', apiKeyId: '' }, // Will be updated below
  })

  // Store the key
  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      name: input.name.trim(),
      keyHash,
      keyPrefix,
      createdById,
      principalId: servicePrincipal.id,
      expiresAt: input.expiresAt ?? null,
      scopes: storedScopes,
    })
    .returning()

  // Update service principal with the actual apiKeyId
  await updatePrincipalFields(
    { principalId: servicePrincipal.id },
    { serviceMetadata: { kind: 'api_key', apiKeyId: apiKey.id } }
  )

  // EVENTING-V2 WO-6a: emit the audit-relevant creation event. A short tx since
  // this service has no surrounding one; exposure.audit writes the audit_log row
  // in the same tx (best-effort — a failure must not fail key creation).
  try {
    await db.transaction((tx) =>
      emit(tx, apiKeyCreated, {
        payload: { apiKeyId: apiKey.id, name: apiKey.name, scopes: storedScopes },
        actor: { type: 'user', id: createdById },
        entityId: apiKey.id,
        context: { source: 'admin' },
      })
    )
  } catch {
    /* best-effort emission; never blocks key creation */
  }

  return { apiKey: toApiKey(apiKey), plainTextKey }
}

/**
 * Verify an API key and return the key record if valid.
 *
 * Uses prefix-based DB lookup + timing-safe hash comparison to prevent
 * timing oracle attacks. Returns null if the key is invalid, expired, or revoked.
 *
 * If `scope` is provided, the key must carry that capability scope or the
 * call returns null. Used by /api/v1/internal/* endpoints which require
 * the `internal:tier-limits` scope.
 */
export async function verifyApiKey(key: string, scope?: string): Promise<ApiKey | null> {
  if (!key || !key.startsWith(API_KEY_PREFIX)) return null

  const keyPrefix = getKeyPrefix(key)
  const keyHash = hashApiKey(key)

  // Look up by prefix (non-secret) instead of hash to avoid DB-level timing leak
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyPrefix, keyPrefix), isNull(apiKeys.revokedAt)),
  })

  // Always perform timing-safe comparison even if no key found (constant-time path)
  const storedHash = apiKey?.keyHash ?? '0'.repeat(64)
  const hashesMatch = timingSafeEqual(Buffer.from(keyHash, 'hex'), Buffer.from(storedHash, 'hex'))

  if (!apiKey || !hashesMatch) return null
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null

  if (scope && !hasScope(apiKey.scopes, scope)) return null

  // Update last used timestamp (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id))
    .execute()
    .catch(() => {
      // Ignore errors updating last used timestamp
    })

  return toApiKey(apiKey)
}

/**
 * Whether the raw stored scopes hold `scope`. Unlike the vocabulary-filtered
 * parseApiKeyScopes, this matches ANY stored entry (internal capability
 * scopes such as `internal:tier-limits`) and fails closed: no stored scopes
 * means no internal capability.
 */
function hasScope(scopesRaw: string | null, scope: string): boolean {
  if (!scopesRaw) return false
  return parseScopesJson(scopesRaw)?.includes(scope) ?? false
}

/**
 * Rotate an API key - generates a new key and invalidates the old one
 *
 * Uses atomic UPDATE with WHERE clause to prevent race conditions
 * (Neon HTTP-compatible, no interactive transactions)
 */
export async function rotateApiKey(id: ApiKeyId): Promise<CreateApiKeyResult> {
  // Generate new key credentials
  const plainTextKey = generateApiKey()
  const keyHash = hashApiKey(plainTextKey)
  const keyPrefix = getKeyPrefix(plainTextKey)

  // Atomic update: only succeeds if key exists and isn't revoked
  const [updatedKey] = await db
    .update(apiKeys)
    .set({
      keyHash,
      keyPrefix,
      lastUsedAt: null, // Reset last used
    })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning()

  if (!updatedKey) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found or already revoked')
  }

  return { apiKey: toApiKey(updatedKey), plainTextKey }
}

/**
 * Revoke an API key (soft delete)
 */
export async function revokeApiKey(id: ApiKeyId): Promise<void> {
  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found or already revoked')
  }

  // Downgrade the service principal so it no longer counts as admin/member
  const revokedKey = result[0]
  if (revokedKey.principalId) {
    // The factory resolves the row's userId and busts PRINCIPAL_BY_USER if set.
    // A service principal has no userId, so this stays a no-op cache-wise, as before.
    await setPrincipalRole({ principalId: revokedKey.principalId }, 'user')
  }

  // EVENTING-V2 WO-6a: audit-relevant deletion event. The actor isn't threaded
  // into this signature yet (WO-6 refinement), so it is attributed to the
  // service plane for now. Best-effort, same as create.
  try {
    await db.transaction((tx) =>
      emit(tx, apiKeyDeleted, {
        payload: { apiKeyId: id },
        actor: { type: 'service' },
        entityId: id,
        context: { source: 'admin' },
      })
    )
  } catch {
    /* best-effort emission; never blocks revocation */
  }
}

/**
 * List all active API keys (excludes revoked)
 */
export async function listApiKeys(): Promise<ApiKey[]> {
  const keys = await db.query.apiKeys.findMany({
    where: isNull(apiKeys.revokedAt),
    orderBy: (apiKeys, { desc }) => [desc(apiKeys.createdAt)],
  })

  return keys.map(toApiKey)
}

/**
 * Get an API key by ID
 */
export async function getApiKeyById(id: ApiKeyId): Promise<ApiKey> {
  const apiKey = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, id),
  })

  if (!apiKey) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found')
  }

  return toApiKey(apiKey)
}

/**
 * Update an API key's name
 */
export async function updateApiKeyName(id: ApiKeyId, name: string): Promise<ApiKey> {
  if (!name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name is required')
  }
  if (name.length > 255) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name must be 255 characters or less')
  }

  const [updated] = await db
    .update(apiKeys)
    .set({ name: name.trim() })
    .where(eq(apiKeys.id, id))
    .returning()

  if (!updated) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found')
  }

  // Sync name to the service principal
  await syncPrincipalProfileById(updated.principalId, { displayName: name.trim() })

  return toApiKey(updated)
}
