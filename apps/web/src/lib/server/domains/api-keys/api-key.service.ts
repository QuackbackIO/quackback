/**
 * API Key Service - Business logic for API key operations
 *
 * Handles creation, validation, rotation, and revocation of API keys
 * for public API authentication.
 */

import { db, apiKeys, eq, and, isNull } from '@/lib/server/db'
import type { MemberId, TypeId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { createHash, randomBytes } from 'crypto'

/** API key prefix */
const API_KEY_PREFIX = 'qb_'

/** Length of the random part of the key (in bytes, will be hex encoded) */
const KEY_RANDOM_BYTES = 24 // 48 hex chars

export type ApiKeyId = TypeId<'api_key'>

export interface ApiKey {
  id: ApiKeyId
  name: string
  keyPrefix: string
  createdById: MemberId
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  revokedAt: Date | null
}

export interface CreateApiKeyInput {
  name: string
  expiresAt?: Date | null
}

export interface CreateApiKeyResult {
  apiKey: ApiKey
  /** The full API key - only returned on creation, never stored */
  plainTextKey: string
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
  createdById: MemberId
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

  // Store the key
  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      name: input.name.trim(),
      keyHash,
      keyPrefix,
      createdById,
      expiresAt: input.expiresAt ?? null,
    })
    .returning()

  return {
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      createdById: apiKey.createdById,
      lastUsedAt: apiKey.lastUsedAt,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      revokedAt: apiKey.revokedAt,
    },
    plainTextKey,
  }
}

/**
 * Verify an API key and return the key record if valid
 *
 * Returns null if the key is invalid, expired, or revoked
 */
export async function verifyApiKey(key: string): Promise<ApiKey | null> {
  // Basic format validation
  if (!key || !key.startsWith(API_KEY_PREFIX)) {
    return null
  }

  const keyHash = hashApiKey(key)

  // Find the key by hash
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)),
  })

  if (!apiKey) {
    return null
  }

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null
  }

  // Update last used timestamp (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id))
    .execute()
    .catch(() => {
      // Ignore errors updating last used timestamp
    })

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    createdById: apiKey.createdById,
    lastUsedAt: apiKey.lastUsedAt,
    expiresAt: apiKey.expiresAt,
    createdAt: apiKey.createdAt,
    revokedAt: apiKey.revokedAt,
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
    })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning()

  if (!updatedKey) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found or already revoked')
  }

  return {
    apiKey: {
      id: updatedKey.id,
      name: updatedKey.name,
      keyPrefix: updatedKey.keyPrefix,
      createdById: updatedKey.createdById,
      lastUsedAt: updatedKey.lastUsedAt,
      expiresAt: updatedKey.expiresAt,
      createdAt: updatedKey.createdAt,
      revokedAt: updatedKey.revokedAt,
    },
    plainTextKey,
  }
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
}

/**
 * List all active API keys (excludes revoked)
 */
export async function listApiKeys(): Promise<ApiKey[]> {
  const keys = await db.query.apiKeys.findMany({
    where: isNull(apiKeys.revokedAt),
    orderBy: (apiKeys, { desc }) => [desc(apiKeys.createdAt)],
  })

  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    createdById: k.createdById,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
  }))
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

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    createdById: apiKey.createdById,
    lastUsedAt: apiKey.lastUsedAt,
    expiresAt: apiKey.expiresAt,
    createdAt: apiKey.createdAt,
    revokedAt: apiKey.revokedAt,
  }
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

  return {
    id: updated.id,
    name: updated.name,
    keyPrefix: updated.keyPrefix,
    createdById: updated.createdById,
    lastUsedAt: updated.lastUsedAt,
    expiresAt: updated.expiresAt,
    createdAt: updated.createdAt,
    revokedAt: updated.revokedAt,
  }
}
