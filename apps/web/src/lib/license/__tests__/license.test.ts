/**
 * Tests for JWT license validation
 */

import { describe, it, expect } from 'vitest'
import * as jose from 'jose'
import { validateLicenseKey, isLicenseExpired } from '../license.server'
import type { LicenseInfo } from '../license.types'

// Private key matching the public key in license.server.ts
// This is the actual keypair - used here for testing purposes
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCN11PnWXV+updJ
sBcZtM+cMAYBc5iHgd71th6ju79DjL90LqX4VR+4gie1OV+7tsImOIW0bCVGOpU4
HT1gINV9Q3+J7AulZRYm+56EHQxhUFgcxnKOhZu0tAgLaLyphMaKAwN3/jgVlat5
RKT2I0ATsjo7WSztoRVALyffqX0Bb4OzTmnPBLKfLD7Ng7vSPMbYLpcDqWDdr30l
18XZCmfYLrj38/M8j0X4qyjUaDu7U2E/NDP7TJ5eqg+yLANevCmtLHjGTYbZD2ff
gfkIlvGDDM4tc4bho06pT0VHPLM/AU7JxYY8taETxxVJHgfWat2mpraLgSMhuvxr
kfb+XE1pAgMBAAECggEAKCMDghbFcbv5LYffsY2Bpg/M00JTqhys69jCKNDq2YGN
d6HvoyrrU/m4pMZ8eZDItaoO47QqhAn1ybA0euwvnUepYmziCsZlE1jmTTovE6Z5
mILrTbsvCV5cXGYh5NJGoC0kISNV2X3FzQYIrAHjku8/HSYp2YBYlBYD8X1zeyEY
Os9sX16lvow8d9C5VeK3zr+JlWDZkO72c4K3q3bEsUmp+cPQ0or42uzGNGqlMXJv
UZih2GnvM1IStg03DrOob31py43V6fgoK37yha/pEcN4ABwVpojkttHRbW4q77Mx
q38W3xUBLFgSdJ0r4/TNyclzoS5mMnEaS74RgCx4lQKBgQDFCrRR25KAWuj3je+W
h9pn07P+YGB5KrpA0jvCmhXXX2RFrsfOhQLM37E2HiMxA57k7Gqop/hF+rNTNJBZ
xJAgInUYA2968jFVM1OWDVXz3jI3dIKm74iMNCSN8cDOqUANWgvCdddsd3o8eMF0
8qFoBOEWE1TT7JxtWsW4YRz5dwKBgQC4SEfU2e9+/O+8Fj7/uIOPkw7up0EiUJ92
58Sp6oI1K3DNRRbZYddF2AE8JeScVmPfOwDS/yBkMIoG/ZMWq7wm37YTkXeOpQiy
1ZstgkDpTQ0kqeSiO2zdKLmu9xGDIPSMEQggX5mbzm8SCXKHhvGXjfy2wStrs6Gb
NyssUfyoHwKBgGQKbUbqTlVw0rttiulIjHEOoWJTmGesc+gZVVIWXWR+ADEI7lVC
XwuZvyWU45UtG21rQzPiJEGTaZyjIW8SR4KpO/43MFChyr5RUuzqVGt+ssxJEVSk
ZRWaG70dsyC5+dVNlI7kub1OY/dz7/Tqg1yGralBo1390eYLojtcwxM9AoGAYID5
nO3EDaxHnyfHNgNaYgWQ/El6Qo4V9B7LTnAQX+ev2s8jeBNUuK61dtohLf3Pr0cm
11fjjpQctCx2qpikn3bn0reK9JhYRc62xM5BT+uZxmlx4cNc7zQ0iPu5oAHSDsec
ideGiaFBaSCpaW+xdLxWax4drvkS2EW7xinpNeECgYEAjMWtfHmASaTcDnuFnSrv
WRPsba0mgT8XXBn8j8Se7wRFreFm9ZWaNwgNdBS3lTUDbxBPLnw8lZpibg6S7JTp
NHGtQJGGE5W16HI8pQGil0W7ch7Vv6FrZ+MxjhKe1pTRMpHnn3+p2X/1WKqQO1HX
8Efn1eGT6HnTcVBzKDvBRsk=
-----END PRIVATE KEY-----`

// Helper to create a signed JWT for testing
async function createTestLicense(claims: {
  sub: string
  tier: string
  seats?: number
  exp?: number
}): Promise<string> {
  const privateKey = await jose.importPKCS8(TEST_PRIVATE_KEY, 'RS256')

  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(privateKey)
}

// Helper to create an expired license
async function createExpiredTestLicense(claims: { sub: string; tier: string }): Promise<string> {
  const privateKey = await jose.importPKCS8(TEST_PRIVATE_KEY, 'RS256')

  // Set expiration to 1 hour ago
  const exp = Math.floor(Date.now() / 1000) - 3600

  return new jose.SignJWT({ ...claims, exp })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(privateKey)
}

describe('License Validation (JWT)', () => {
  describe('validateLicenseKey', () => {
    it('returns null for empty string', async () => {
      expect(await validateLicenseKey('')).toBeNull()
    })

    it('returns null for whitespace-only string', async () => {
      expect(await validateLicenseKey('   ')).toBeNull()
    })

    it('returns null for invalid JWT format', async () => {
      expect(await validateLicenseKey('not-a-jwt')).toBeNull()
    })

    it('returns null for JWT with wrong signature', async () => {
      // Create a JWT with a different private key
      const otherPrivateKey = await jose.generateKeyPair('RS256')
      const wronglySignedJwt = await new jose.SignJWT({
        sub: 'Test Company',
        tier: 'enterprise',
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .sign(otherPrivateKey.privateKey)

      expect(await validateLicenseKey(wronglySignedJwt)).toBeNull()
    })

    it('returns null when sub claim is missing', async () => {
      const privateKey = await jose.importPKCS8(TEST_PRIVATE_KEY, 'RS256')
      const noSubJwt = await new jose.SignJWT({ tier: 'enterprise' })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .sign(privateKey)

      expect(await validateLicenseKey(noSubJwt)).toBeNull()
    })

    it('returns null when tier is not enterprise', async () => {
      const jwt = await createTestLicense({
        sub: 'Test Company',
        tier: 'pro', // Wrong tier
      })

      expect(await validateLicenseKey(jwt)).toBeNull()
    })

    it('parses valid license without expiration', async () => {
      const jwt = await createTestLicense({
        sub: 'Test Company',
        tier: 'enterprise',
      })

      const result = await validateLicenseKey(jwt)

      expect(result).not.toBeNull()
      expect(result?.valid).toBe(true)
      expect(result?.tier).toBe('enterprise')
      expect(result?.licensee).toBe('Test Company')
      expect(result?.expiresAt).toBeNull()
      expect(result?.seats).toBeNull()
    })

    it('parses valid license with expiration', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 86400 * 365 // 1 year from now
      const jwt = await createTestLicense({
        sub: 'Test Company',
        tier: 'enterprise',
        exp: futureExp,
      })

      const result = await validateLicenseKey(jwt)

      expect(result).not.toBeNull()
      expect(result?.valid).toBe(true)
      expect(result?.expiresAt).toBeInstanceOf(Date)
      expect(result?.expiresAt?.getTime()).toBe(futureExp * 1000)
    })

    it('parses valid license with seat count', async () => {
      const jwt = await createTestLicense({
        sub: 'Test Company',
        tier: 'enterprise',
        seats: 50,
      })

      const result = await validateLicenseKey(jwt)

      expect(result).not.toBeNull()
      expect(result?.seats).toBe(50)
    })

    it('returns null for expired JWT (exp in past)', async () => {
      const jwt = await createExpiredTestLicense({
        sub: 'Test Company',
        tier: 'enterprise',
      })

      // jose.jwtVerify rejects expired tokens by default
      expect(await validateLicenseKey(jwt)).toBeNull()
    })
  })

  describe('isLicenseExpired', () => {
    it('returns true for invalid license', () => {
      const invalidLicense: LicenseInfo = {
        valid: false,
        tier: 'enterprise',
        expiresAt: null,
        licensee: null,
        seats: null,
      }
      expect(isLicenseExpired(invalidLicense)).toBe(true)
    })

    it('returns false for valid license without expiration', () => {
      const validLicense: LicenseInfo = {
        valid: true,
        tier: 'enterprise',
        expiresAt: null,
        licensee: 'Test',
        seats: null,
      }
      expect(isLicenseExpired(validLicense)).toBe(false)
    })

    it('returns false for license with future expiration', () => {
      const futureDate = new Date()
      futureDate.setFullYear(futureDate.getFullYear() + 1)

      const validLicense: LicenseInfo = {
        valid: true,
        tier: 'enterprise',
        expiresAt: futureDate,
        licensee: 'Test',
        seats: null,
      }
      expect(isLicenseExpired(validLicense)).toBe(false)
    })

    it('returns true for license with past expiration', () => {
      const pastDate = new Date()
      pastDate.setFullYear(pastDate.getFullYear() - 1)

      const expiredLicense: LicenseInfo = {
        valid: true,
        tier: 'enterprise',
        expiresAt: pastDate,
        licensee: 'Test',
        seats: null,
      }
      expect(isLicenseExpired(expiredLicense)).toBe(true)
    })
  })
})
