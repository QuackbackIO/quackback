/**
 * OAuth State Signing Utilities
 *
 * Provides HMAC-SHA256 signing and verification for OAuth state parameters.
 * This prevents attackers from crafting malicious state with arbitrary
 * returnDomain or callbackUrl values.
 */

import crypto from 'crypto'

const SIGNATURE_SEPARATOR = '.'

function getSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required for OAuth state signing')
  }
  return secret
}

/**
 * Sign an OAuth state object with HMAC-SHA256
 *
 * Format: base64url(json).base64url(signature)
 */
export function signOAuthState(data: object): string {
  const json = JSON.stringify(data)
  const jsonBase64 = Buffer.from(json).toString('base64url')

  const signature = crypto.createHmac('sha256', getSecret()).update(json).digest('base64url')

  return `${jsonBase64}${SIGNATURE_SEPARATOR}${signature}`
}

/**
 * Verify and decode a signed OAuth state
 *
 * Returns the decoded state object if valid, null if invalid/tampered
 */
export function verifyOAuthState<T = unknown>(signedState: string): T | null {
  const separatorIndex = signedState.lastIndexOf(SIGNATURE_SEPARATOR)
  if (separatorIndex === -1) {
    return null
  }

  const jsonBase64 = signedState.substring(0, separatorIndex)
  const providedSignature = signedState.substring(separatorIndex + 1)

  let json: string
  try {
    json = Buffer.from(jsonBase64, 'base64url').toString()
  } catch {
    return null
  }

  // Compute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', getSecret())
    .update(json)
    .digest('base64url')

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
