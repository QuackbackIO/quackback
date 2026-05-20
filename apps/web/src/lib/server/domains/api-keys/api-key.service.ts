/**
 * API Key Service - Business logic for API key operations
 *
 * Handles creation, validation, rotation, and revocation of API keys
 * for public API authentication.
 */

import { db, apiKeys, principal, eq, and, isNull } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isAdmin } from '@/lib/shared/roles'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { config } from '@/lib/server/config'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.service'
import { ALL_PERMISSIONS } from '@/lib/server/domains/authz/authz.permissions'
import type {
  ApiKey,
  ApiKeyId,
  CreateApiKeyInput,
  CreateApiKeyResult,
  UpdateApiKeyInput,
} from './api-key.types'
export type { ApiKey, ApiKeyId, CreateApiKeyInput, CreateApiKeyResult, UpdateApiKeyInput }

/** API key prefix */
const API_KEY_PREFIX = 'qb_'

/** Length of the random part of the key (in bytes, will be hex encoded) */
const KEY_RANDOM_BYTES = 24 // 48 hex chars

/** Map a database row to the public ApiKey shape (strips keyHash). */
function toApiKey(row: ApiKey & Record<string, unknown>): ApiKey {
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
    scopes: (row.scopes as string[]) ?? [],
    allowedTeamIds: (row.allowedTeamIds as string[]) ?? [],
    allowedInboxIds: (row.allowedInboxIds as string[]) ?? [],
    lastIp: (row.lastIp as string | null) ?? null,
    lastUserAgent: (row.lastUserAgent as string | null) ?? null,
    rotatedAt: (row.rotatedAt as Date | null) ?? null,
    compatLegacyFullAccess: (row.compatLegacyFullAccess as boolean | undefined) ?? true,
    compatAcknowledgedAt: (row.compatAcknowledgedAt as Date | null) ?? null,
  }
}

const ALL_PERMISSION_SET = new Set<string>(ALL_PERMISSIONS as readonly string[])

function validateScopes(scopes: readonly string[] | undefined): string[] {
  if (!scopes || scopes.length === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of scopes) {
    const v = String(s).trim()
    if (!v) continue
    if (!ALL_PERMISSION_SET.has(v)) {
      throw new ValidationError('VALIDATION_ERROR', `Unknown permission scope: ${v}`)
    }
    if (!seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

function dedupeIds(ids: readonly string[] | undefined): string[] {
  if (!ids || ids.length === 0) return []
  return Array.from(new Set(ids.map((s) => String(s).trim()).filter(Boolean)))
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
 * Hash an API key for storage using HMAC-SHA256.
 *
 * Uses the server's SECRET_KEY as the HMAC key so that stolen database
 * hashes are useless without the application secret. The API key itself
 * has 192 bits of entropy (24 random bytes), making brute-force infeasible.
 */
function hashApiKey(key: string): string {
  return createHmac('sha256', config.secretKey).update(key).digest('hex')
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

  // Generate the key
  const plainTextKey = generateApiKey()
  const keyHash = hashApiKey(plainTextKey)
  const keyPrefix = getKeyPrefix(plainTextKey)

  const scopes = validateScopes(input.scopes)
  const allowedTeamIds = dedupeIds(input.allowedTeamIds)
  const allowedInboxIds = dedupeIds(input.allowedInboxIds)

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
      scopes,
      allowedTeamIds,
      allowedInboxIds,
      // If any scope is set explicitly at creation, drop legacy compat.
      compatLegacyFullAccess: scopes.length === 0,
    })
    .returning()

  // Update service principal with the actual apiKeyId
  await db
    .update(principal)
    .set({ serviceMetadata: { kind: 'api_key', apiKeyId: apiKey.id } })
    .where(eq(principal.id, servicePrincipal.id))

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

function hasScope(scopesRaw: string | null, scope: string): boolean {
  if (!scopesRaw) return false
  try {
    const parsed = JSON.parse(scopesRaw)
    return Array.isArray(parsed) && parsed.includes(scope)
  } catch {
    return false
  }
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
      rotatedAt: new Date(),
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
    await db.update(principal).set({ role: 'user' }).where(eq(principal.id, revokedKey.principalId))
    // Service principals don't typically render SSR pages, but keep the
    // PRINCIPAL_BY_USER cache consistent in case one ever does.
    const p = await db.query.principal.findFirst({
      where: eq(principal.id, revokedKey.principalId),
      columns: { userId: true },
    })
    if (p?.userId) {
      const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
      await cacheDel(CACHE_KEYS.PRINCIPAL_BY_USER(p.userId))
    }
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
  await db
    .update(principal)
    .set({ displayName: name.trim() })
    .where(eq(principal.id, updated.principalId))

  return toApiKey(updated)
}

/**
 * Update an API key. Any combination of name + scopes + allowedTeamIds +
 * allowedInboxIds may be supplied. Setting any non-empty `scopes` clears
 * `compatLegacyFullAccess` automatically.
 */
export async function updateApiKey(id: ApiKeyId, input: UpdateApiKeyInput): Promise<ApiKey> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    if (!input.name?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'API key name is required')
    }
    if (input.name.length > 255) {
      throw new ValidationError('VALIDATION_ERROR', 'API key name must be 255 characters or less')
    }
    patch.name = input.name.trim()
  }
  let scopesAfter: string[] | undefined
  if (input.scopes !== undefined) {
    scopesAfter = validateScopes(input.scopes)
    patch.scopes = scopesAfter
    if (scopesAfter.length > 0) {
      patch.compatLegacyFullAccess = false
    }
  }
  if (input.allowedTeamIds !== undefined) {
    patch.allowedTeamIds = dedupeIds(input.allowedTeamIds)
  }
  if (input.allowedInboxIds !== undefined) {
    patch.allowedInboxIds = dedupeIds(input.allowedInboxIds)
  }

  if (Object.keys(patch).length === 0) {
    return getApiKeyById(id)
  }

  const [updated] = await db.update(apiKeys).set(patch).where(eq(apiKeys.id, id)).returning()
  if (!updated) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found')
  }

  if (input.name !== undefined) {
    await db
      .update(principal)
      .set({ displayName: input.name.trim() })
      .where(eq(principal.id, updated.principalId))
  }

  return toApiKey(updated)
}

/**
 * Mark the legacy "all permissions" compatibility flag as acknowledged.
 * Does NOT change behavior — it just suppresses the warning surfaced via
 * `compatLegacyFullAccess` until scopes are actually set.
 */
export async function acknowledgeLegacyCompat(id: ApiKeyId): Promise<ApiKey> {
  const [updated] = await db
    .update(apiKeys)
    .set({ compatAcknowledgedAt: new Date() })
    .where(eq(apiKeys.id, id))
    .returning()
  if (!updated) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found')
  }
  return toApiKey(updated)
}
