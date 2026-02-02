/**
 * Webhook-specific encryption for signing secrets.
 *
 * Uses purpose-based key derivation to ensure webhook secrets
 * are encrypted with a key separate from other domains.
 */
import { encrypt, decrypt } from '@/lib/server/encryption'

const PURPOSE = 'webhook-secrets'

/**
 * Encrypt a webhook signing secret.
 */
export function encryptWebhookSecret(secret: string): string {
  return encrypt(secret, PURPOSE)
}

/**
 * Decrypt a webhook signing secret.
 */
export function decryptWebhookSecret(ciphertext: string): string {
  return decrypt(ciphertext, PURPOSE)
}
