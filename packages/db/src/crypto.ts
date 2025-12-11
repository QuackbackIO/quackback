/**
 * Token encryption utilities for integration OAuth tokens.
 * Uses AES-256-GCM with organization-scoped key derivation.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

/**
 * Derives an organization-specific encryption key from the master key.
 * Uses scrypt for key derivation with organizationId as salt.
 */
function deriveKey(organizationId: string): Buffer {
  const masterKey = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!masterKey) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY environment variable not set')
  }
  return scryptSync(masterKey, organizationId, KEY_LENGTH)
}

/**
 * Encrypts a token using AES-256-GCM with organization-scoped key.
 * @param token - The plaintext token to encrypt
 * @param organizationId - Used as salt for key derivation
 * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
 */
export function encryptToken(token: string, organizationId: string): string {
  const key = deriveKey(organizationId)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

/**
 * Decrypts a token that was encrypted with encryptToken().
 * @param encrypted - The encrypted string in format: iv:authTag:ciphertext
 * @param organizationId - Must match the organizationId used during encryption
 * @returns The decrypted plaintext token
 */
export function decryptToken(encrypted: string, organizationId: string): string {
  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format')
  }

  const [ivB64, authTagB64, dataB64] = parts

  const key = deriveKey(organizationId)
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length')
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return decipher.update(data).toString('utf8') + decipher.final('utf8')
}
