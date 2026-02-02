/**
 * Integration-specific encryption for OAuth tokens.
 *
 * Uses purpose-based key derivation to ensure integration tokens
 * are encrypted with a key separate from other domains.
 */
import { encrypt, decrypt } from '@/lib/server/encryption'

const PURPOSE = 'integration-tokens'

/**
 * Encrypt an integration OAuth access token.
 */
export function encryptIntegrationToken(token: string): string {
  return encrypt(token, PURPOSE)
}

/**
 * Decrypt an integration OAuth access token.
 */
export function decryptIntegrationToken(ciphertext: string): string {
  return decrypt(ciphertext, PURPOSE)
}
