/**
 * Server-side license validation for self-hosted enterprise
 *
 * License keys are JWT tokens signed with RS256 (RSA + SHA-256).
 * The public key is embedded in the app for offline verification.
 * The private key is kept secret and used to sign licenses.
 */

import { cache } from 'react'
import * as jose from 'jose'
import type { LicenseInfo } from './license.types'
import { NO_LICENSE } from './license.types'

/**
 * Public key for verifying license signatures.
 * This key is safe to commit - it can only verify, not create licenses.
 */
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjddT51l1frqXSbAXGbTP
nDAGAXOYh4He9bYeo7u/Q4y/dC6l+FUfuIIntTlfu7bCJjiFtGwlRjqVOB09YCDV
fUN/iewLpWUWJvuehB0MYVBYHMZyjoWbtLQIC2i8qYTGigMDd/44FZWreUSk9iNA
E7I6O1ks7aEVQC8n36l9AW+Ds05pzwSynyw+zYO70jzG2C6XA6lg3a99JdfF2Qpn
2C649/PzPI9F+Kso1Gg7u1NhPzQz+0yeXqoPsiwDXrwprSx4xk2G2Q9n34H5CJbx
gwzOLXOG4aNOqU9FRzyzPwFOycWGPLWhE8cVSR4H1mrdpqa2i4EjIbr8a5H2/lxN
aQIDAQAB
-----END PUBLIC KEY-----`

/**
 * Expected JWT claims for a valid license
 */
interface LicenseClaims {
  /** Licensee name/organization */
  sub: string
  /** License tier */
  tier: 'enterprise'
  /** Seat count (optional) */
  seats?: number
  /** Issued at timestamp */
  iat?: number
  /** Expiration timestamp */
  exp?: number
}

// Cache the imported public key
let cachedPublicKey: jose.KeyLike | null = null

async function getPublicKey(): Promise<jose.KeyLike> {
  if (!cachedPublicKey) {
    cachedPublicKey = await jose.importSPKI(LICENSE_PUBLIC_KEY, 'RS256')
  }
  return cachedPublicKey
}

/**
 * Validate a license key (JWT) and extract license info
 *
 * @param token - The JWT license key
 * @returns License info if valid, null if invalid
 *
 * @example
 * ```ts
 * const license = await validateLicenseKey(process.env.ENTERPRISE_LICENSE_KEY)
 * if (license?.valid) {
 *   console.log(`Licensed to: ${license.licensee}`)
 * }
 * ```
 */
export async function validateLicenseKey(token: string): Promise<LicenseInfo | null> {
  if (!token || token.trim() === '') {
    return null
  }

  try {
    const publicKey = await getPublicKey()

    // Verify the JWT signature and decode claims
    const { payload } = await jose.jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
    })

    const claims = payload as unknown as LicenseClaims

    // Validate required fields
    if (typeof claims.sub !== 'string' || !claims.sub) {
      return null
    }

    if (claims.tier !== 'enterprise') {
      return null
    }

    // Parse expiration from JWT exp claim
    let expiresAt: Date | null = null
    if (claims.exp) {
      expiresAt = new Date(claims.exp * 1000) // JWT exp is in seconds
    }

    return {
      valid: true,
      tier: 'enterprise',
      expiresAt,
      licensee: claims.sub,
      seats: typeof claims.seats === 'number' ? claims.seats : null,
    }
  } catch {
    // Invalid JWT, signature verification failed, or expired
    return null
  }
}

/**
 * Check if a license has expired
 */
export function isLicenseExpired(license: LicenseInfo): boolean {
  if (!license.valid) return true
  if (!license.expiresAt) return false
  return license.expiresAt < new Date()
}

/**
 * Get license info from environment variable or database
 * Cached per request for efficiency
 */
export const getLicenseInfo = cache(async (): Promise<LicenseInfo> => {
  // First check environment variable
  const envKey = process.env.ENTERPRISE_LICENSE_KEY
  if (envKey) {
    const license = await validateLicenseKey(envKey)
    if (license && !isLicenseExpired(license)) {
      return license
    }
  }

  // TODO: Check database for license key stored via admin UI
  // This would involve importing the settings repository and checking
  // a licenseKey field in the settings table

  return NO_LICENSE
})

/**
 * Check if the current installation has a valid enterprise license
 */
export async function hasEnterpriseLicense(): Promise<boolean> {
  const license = await getLicenseInfo()
  return license.valid && !isLicenseExpired(license)
}
