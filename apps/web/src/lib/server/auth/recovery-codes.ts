/**
 * SSO recovery-code primitives.
 *
 * Codes are 12-character Crockford base32 strings (60 bits of entropy)
 * formatted as `XXXX-XXXX-XXXX` for readability. The Crockford alphabet
 * omits the visually ambiguous characters 0/O and I/L/U, so typed codes
 * round-trip cleanly even when the admin reads them off paper or a
 * printout.
 *
 * Hashing matches the better-auth scrypt format (`{salt_hex}:{key_hex}`)
 * so future migration to a unified password/recovery store doesn't need
 * a re-hash sweep. Salts are 16 random bytes; the scrypt parameters
 * (N=16384, r=16, p=1, dkLen=64) match better-auth's defaults so a
 * machine that's already provisioned for password hashing has no extra
 * cost.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>

/** Crockford base32 alphabet — 32 characters, no 0/O or I/L/U. */
export const RECOVERY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Per-block character count. 12 chars total in groups of 4. */
const CODE_LENGTH = 12
const GROUP_SIZE = 4

const SCRYPT_PARAMS = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64,
  maxmem: 128 * 16384 * 16 * 2,
} as const
const SALT_BYTES = 16

/**
 * Generate a fresh recovery code. Uses crypto.randomBytes for entropy
 * and folds 60 bits into 12 Crockford-base32 characters, then inserts
 * dashes after every 4 characters.
 */
export function generateRecoveryCode(): string {
  // 12 chars × 5 bits = 60 bits. Pull 8 bytes (64 bits) and discard
  // the low 4 bits so we end up with exactly 60 bits.
  const bytes = randomBytes(8)
  let bits = 0n
  for (const b of bytes) {
    bits = (bits << 8n) | BigInt(b)
  }
  bits >>= 4n // drop the bottom 4 bits

  const chars: string[] = []
  for (let i = 0; i < CODE_LENGTH; i++) {
    chars.push(RECOVERY_CODE_ALPHABET[Number(bits & 0x1fn)])
    bits >>= 5n
  }
  chars.reverse()

  const groups: string[] = []
  for (let i = 0; i < CODE_LENGTH; i += GROUP_SIZE) {
    groups.push(chars.slice(i, i + GROUP_SIZE).join(''))
  }
  return groups.join('-')
}

/**
 * Normalise a user-supplied recovery code: uppercase, strip dashes and
 * whitespace. Lets the admin paste with or without dashes, in any case.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}

/** Salted scrypt digest in `{salt_hex}:{key_hex}` shape. */
export async function hashRecoveryCode(code: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await scrypt(normalizeRecoveryCode(code), salt, SCRYPT_PARAMS.dkLen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  })
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

/**
 * Constant-time comparison of a candidate code against the stored hash.
 * Accepts the code in any user-friendly presentation (mixed case,
 * with/without dashes). Returns false on malformed hashes — never throws.
 */
export async function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(':')
  if (!saltHex || !keyHex) return false
  try {
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(keyHex, 'hex')
    if (expected.length === 0 || salt.length === 0) return false
    const actual = await scrypt(normalizeRecoveryCode(code), salt, expected.length, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
