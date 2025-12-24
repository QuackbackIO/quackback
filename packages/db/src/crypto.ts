/**
 * Encryption utilities for sensitive data.
 *
 * Uses AES-256-GCM for symmetric encryption with a salt parameter.
 * This is used for encrypting OAuth tokens, API keys, and other secrets.
 * In single-tenant mode, the workspace ID is typically used as the salt.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY

function deriveKey(salt: string): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY is required for encryption')
  }
  // Use scrypt to derive a 256-bit key from the base key + salt
  return scryptSync(ENCRYPTION_KEY, salt, 32)
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param salt - A unique salt to derive the key
 * @returns Base64-encoded ciphertext with IV and auth tag
 */
export function encryptToken(plaintext: string, salt: string): string {
  const key = deriveKey(salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

/**
 * Decrypt a ciphertext string encrypted with encryptToken.
 *
 * @param ciphertext - Base64-encoded ciphertext from encryptToken
 * @param salt - The same salt used during encryption
 * @returns The original plaintext string
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decryptToken(ciphertext: string, salt: string): string {
  const key = deriveKey(salt)
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':')

  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Invalid ciphertext format')
  }

  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedB64, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
