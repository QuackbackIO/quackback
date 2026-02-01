/**
 * OAuth State Signing Utilities
 *
 * Provides HMAC-SHA256 signing and verification for OAuth state parameters.
 * Also provides AES-GCM encryption for sensitive data in OAuth state.
 */

import crypto from 'crypto'
import type { PortableOIDCConfig } from './oauth-utils'

export type { PortableOIDCConfig } from './oauth-utils'

const SIGNATURE_SEPARATOR = '.'

function getSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required for OAuth state signing')
  }
  return secret
}

function getDerivedKey(): Buffer {
  return crypto.createHash('sha256').update(getSecret()).digest()
}

function computeSignature(json: string): string {
  return crypto.createHmac('sha256', getSecret()).update(json).digest('base64url')
}

/**
 * Sign an OAuth state object with HMAC-SHA256.
 * Format: base64url(json).base64url(signature)
 */
export function signOAuthState(data: object): string {
  const json = JSON.stringify(data)
  const payload = Buffer.from(json).toString('base64url')
  const signature = computeSignature(json)
  return `${payload}${SIGNATURE_SEPARATOR}${signature}`
}

/**
 * Verify and decode a signed OAuth state.
 * Returns the decoded state object if valid, null if invalid/tampered.
 */
export function verifyOAuthState<T = unknown>(signedState: string): T | null {
  const separatorIndex = signedState.lastIndexOf(SIGNATURE_SEPARATOR)
  if (separatorIndex === -1) {
    return null
  }

  const payload = signedState.substring(0, separatorIndex)
  const providedSignature = signedState.substring(separatorIndex + 1)

  let json: string
  try {
    json = Buffer.from(payload, 'base64url').toString()
  } catch {
    return null
  }

  const expectedSignature = computeSignature(json)

  // Constant-time comparison to prevent timing attacks
  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (providedBuffer.length !== expectedBuffer.length) {
    return null
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null
  }

  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * Encrypt data using AES-256-GCM.
 * Format: base64url(iv + ciphertext + authTag)
 */
function encryptData(data: string): string {
  const key = getDerivedKey()
  const iv = crypto.randomBytes(12)

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, encrypted, authTag]).toString('base64url')
}

/**
 * Decrypt data encrypted with encryptData.
 * Returns null if decryption fails.
 */
function decryptData(encryptedData: string): string | null {
  try {
    const key = getDerivedKey()
    const combined = Buffer.from(encryptedData, 'base64url')

    const iv = combined.subarray(0, 12)
    const authTag = combined.subarray(combined.length - 16)
    const encrypted = combined.subarray(12, combined.length - 16)

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function encryptOIDCConfig(config: PortableOIDCConfig): string {
  return encryptData(JSON.stringify(config))
}

export function decryptOIDCConfig(encryptedConfig: string): PortableOIDCConfig | null {
  const json = decryptData(encryptedConfig)
  if (!json) return null

  try {
    return JSON.parse(json) as PortableOIDCConfig
  } catch {
    return null
  }
}

export function encryptCodeVerifier(verifier: string): string {
  return encryptData(verifier)
}

export function decryptCodeVerifier(encryptedVerifier: string): string | null {
  return decryptData(encryptedVerifier)
}
