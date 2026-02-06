/**
 * Integration secrets encryption.
 *
 * Encrypts/decrypts the JSON secrets blob stored in the integrations table.
 * Uses purpose-based key derivation to isolate integration keys from other domains.
 */
import { encrypt, decrypt } from '@/lib/server/encryption'

const PURPOSE = 'integration-tokens'

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
