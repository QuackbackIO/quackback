/**
 * PKCE (RFC 7636, S256). One helper so authorize/token flows don't mint
 * their own verifier/challenge pair.
 */
import { createHash, randomBytes } from 'node:crypto'

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}
