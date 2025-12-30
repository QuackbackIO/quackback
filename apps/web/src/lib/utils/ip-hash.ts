import { createHash } from 'crypto'

/**
 * Hash an IP address for privacy-preserving storage
 * Uses SHA-256 with a salt and truncates for storage efficiency
 *
 * @param ip - The IP address to hash
 * @param salt - Salt to add entropy (use BETTER_AUTH_SECRET or similar)
 * @returns Truncated SHA-256 hash of the IP
 */
export function hashIP(ip: string, salt: string): string {
  return createHash('sha256')
    .update(ip + salt)
    .digest('hex')
    .slice(0, 16) // Truncate for storage efficiency
}
