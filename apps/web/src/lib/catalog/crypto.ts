/**
 * Token decryption utilities for connection strings.
 * Uses AES-256-GCM with workspace-scoped key derivation.
 *
 * This mirrors the encryption in the website codebase.
 * Connection strings are encrypted with the workspace ID as salt.
 */
import { scrypt, createDecipheriv } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const AUTH_TAG_LENGTH = 16

/**
 * Derives a workspace-specific encryption key from the master key.
 * Uses async scrypt for key derivation with workspaceId as salt.
 */
async function deriveKey(workspaceId: string): Promise<Buffer> {
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY environment variable is required')
  }
  return scryptAsync(encryptionKey, workspaceId, KEY_LENGTH) as Promise<Buffer>
}

/**
 * Decrypts a value that was encrypted with encryptToken().
 * @param encrypted - The encrypted string in format: iv:authTag:ciphertext (all base64)
 * @param workspaceId - Must match the workspaceId used during encryption
 * @returns The decrypted plaintext value
 */
export async function decryptConnectionString(
  encrypted: string,
  workspaceId: string
): Promise<string> {
  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format')
  }

  const [ivB64, authTagB64, dataB64] = parts

  const key = await deriveKey(workspaceId)
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
