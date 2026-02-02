/**
 * OAuth State Signing Utilities
 *
 * Provides HMAC-SHA256 signing and verification for OAuth state parameters.
 * Used for Slack OAuth integration.
 */

import crypto from 'crypto'
import { config } from '@/lib/server/config'

const SIGNATURE_SEPARATOR = '.'

function getSecret(): string {
  return config.secretKey
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
