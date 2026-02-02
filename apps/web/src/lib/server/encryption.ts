/**
 * Domain-separated symmetric encryption using AES-256-GCM.
 *
 * Each encryption purpose derives a unique key from the master secret
 * using HKDF (RFC 5869). This provides cryptographic isolation between
 * different uses (integrations, webhooks, API keys, etc.).
 *
 * @see https://tools.ietf.org/html/rfc5869
 */

import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { config } from './config'

// =============================================================================
// Constants
// =============================================================================

const ALGORITHM = 'aes-256-gcm' as const
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 12 // 96 bits (recommended for GCM)
const AUTH_TAG_LENGTH = 16 // 128 bits

/**
 * Fixed salt for HKDF key derivation.
 * Provides defense-in-depth even if SECRET_KEY has lower entropy than recommended.
 */
const HKDF_SALT = 'quackback-encryption-salt-v1'

/**
 * Application prefix for all HKDF info strings.
 * Format: "quackback:<version>:<purpose>"
 */
const INFO_PREFIX = 'quackback:v1'

// =============================================================================
// Key Derivation
// =============================================================================

const derivedKeys = new Map<string, Buffer>()

/**
 * Derive a purpose-specific encryption key using HKDF-SHA256.
 *
 * @param purpose - Identifies what the key is used for (e.g., 'integration-tokens')
 * @returns 256-bit derived key
 */
function deriveKey(purpose: string): Buffer {
  const cached = derivedKeys.get(purpose)
  if (cached) return cached

  // HKDF info string provides domain separation
  const info = `${INFO_PREFIX}:${purpose}`

  const derived = hkdfSync('sha256', config.secretKey, HKDF_SALT, info, KEY_LENGTH)

  const key = Buffer.from(derived)
  derivedKeys.set(purpose, key)
  return key
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Encrypt a plaintext string for a specific purpose.
 *
 * @param plaintext - The string to encrypt
 * @param purpose - Encryption purpose for key derivation (e.g., 'integration-tokens')
 * @returns Base64url-encoded ciphertext in format: iv.authTag.ciphertext
 *
 * @example
 * const encrypted = encrypt(accessToken, 'integration-tokens')
 */
export function encrypt(plaintext: string, purpose: string): string {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('Plaintext must be a non-empty string')
  }
  if (!purpose || typeof purpose !== 'string') {
    throw new Error('Encryption purpose is required')
  }

  const key = deriveKey(purpose)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Format: iv.authTag.ciphertext (base64url for URL safety)
  return [
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/**
 * Decrypt a ciphertext string for a specific purpose.
 *
 * @param ciphertext - The encrypted string from encrypt()
 * @param purpose - Must match the purpose used for encryption
 * @returns The original plaintext string
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 *
 * @example
 * const token = decrypt(storedValue, 'integration-tokens')
 */
export function decrypt(ciphertext: string, purpose: string): string {
  if (!purpose || typeof purpose !== 'string') {
    throw new Error('Encryption purpose is required')
  }

  const parts = ciphertext.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format')
  }

  const [ivB64, authTagB64, encryptedB64] = parts
  const iv = Buffer.from(ivB64, 'base64url')
  const authTag = Buffer.from(authTagB64, 'base64url')
  const encrypted = Buffer.from(encryptedB64, 'base64url')

  // Validate lengths to fail fast
  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length')
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length')
  }

  const key = deriveKey(purpose)
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(authTag)

  try {
    return decipher.update(encrypted) + decipher.final('utf8')
  } catch {
    throw new Error('Decryption failed: invalid key or corrupted data')
  }
}

/**
 * Reset derived key cache (for testing only).
 */
export function _resetKeyCache(): void {
  derivedKeys.clear()
}
