/**
 * Integration secrets encryption.
 *
 * Encrypts/decrypts the JSON secrets blob stored in the integrations table.
 * Uses purpose-based key derivation to isolate integration keys from other domains.
 */
import { encrypt, decrypt } from '@/lib/server/encryption'

const PURPOSE = 'integration-tokens'
const PLATFORM_CRED_PURPOSE = 'integration-platform-credentials'

/**
 * Encrypt an integration secrets object to a ciphertext string.
 */
export function encryptSecrets(secrets: Record<string, unknown>): string {
  return encrypt(JSON.stringify(secrets), PURPOSE)
}

/**
 * Decrypt a ciphertext string back to the integration secrets object.
 */
export function decryptSecrets<T = Record<string, unknown>>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext, PURPOSE)) as T
}

/**
 * Encrypt platform credentials (OAuth app client ID/secret etc.) to a ciphertext string.
 * Uses a separate HKDF-derived key from instance tokens for cryptographic isolation.
 */
export function encryptPlatformCredentials(creds: Record<string, string>): string {
  return encrypt(JSON.stringify(creds), PLATFORM_CRED_PURPOSE)
}

/**
 * Decrypt platform credentials ciphertext back to the credentials object.
 */
export function decryptPlatformCredentials<T = Record<string, string>>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext, PLATFORM_CRED_PURPOSE)) as T
}
