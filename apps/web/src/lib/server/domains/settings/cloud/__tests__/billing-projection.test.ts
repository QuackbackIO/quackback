import { exportSPKI, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  BILLING_PROJECTION_AUDIENCE,
  BILLING_PROJECTION_ISSUER,
  BILLING_PROJECTION_TYPE,
  verifyBillingProjectionToken,
} from '../billing-projection.signature'
import {
  BillingProjectionWriteError,
  decideBillingProjectionWrite,
  writeBillingProjection,
} from '../billing-projection.write'
import type { BillingProjection } from '../billing-projection'
import { resolveCloudConfig } from '../cloud.service'

const LIMITS = {
  maxBoards: 25,
  maxPosts: 1_000,
  maxTeamSeats: 10,
  maxStatusComponents: 25,
  maxCustomRoles: 5,
  maxSendingDomains: 3,
  aiTokensPerMonth: 100_000,
  emailsPerMonth: null,
  apiRequestsPerMonth: 100_000,
  apiRequestsPerMinute: 600,
}

const PROJECTION: BillingProjection = {
  version: 7,
  effectivePlan: 'pro',
  trialStartedAt: '2026-08-01T00:00:00.000Z',
  trialExpiresAt: '2026-08-15T00:00:00.000Z',
  subscriptionStatus: null,
  entitlements: { customDomain: true },
  freeLimits: { ...LIMITS, maxBoards: 2 },
  planLimits: LIMITS,
  planLimitsExpireAt: '2026-08-15T00:00:00.000Z',
  canUpgrade: true,
  canManageBilling: false,
  renewalAt: null,
  cancellationAt: null,
}

async function signedToken(
  workspaceKey: string,
  projection: BillingProjection,
  privateKey: CryptoKey
): Promise<string> {
  return new SignJWT({ workspaceKey, projection })
    .setProtectedHeader({ alg: 'EdDSA', typ: BILLING_PROJECTION_TYPE })
    .setIssuer(BILLING_PROJECTION_ISSUER)
    .setAudience(BILLING_PROJECTION_AUDIENCE)
    .setIssuedAt()
    .sign(privateKey)
}

describe('billing projection signatures', () => {
  it('verifies a workspace-bound projection from the configured public key', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
    const publicPem = await exportSPKI(publicKey)
    const token = await signedToken('inst_acme', PROJECTION, privateKey)

    await expect(verifyBillingProjectionToken(token, publicPem)).resolves.toEqual({
      workspaceKey: 'inst_acme',
      projection: PROJECTION,
    })
  })

  it('rejects a token signed by a different control-plane key', async () => {
    const trusted = await generateKeyPair('EdDSA', { extractable: true })
    const attacker = await generateKeyPair('EdDSA', { extractable: true })
    const trustedPublicPem = await exportSPKI(trusted.publicKey)
    const token = await signedToken('inst_acme', PROJECTION, attacker.privateKey)

    await expect(verifyBillingProjectionToken(token, trustedPublicPem)).rejects.toThrow()
  })
})

describe('billing projection monotonicity', () => {
  it('accepts an identical version as an idempotent replay', () => {
    expect(decideBillingProjectionWrite(PROJECTION, { ...PROJECTION })).toBe('idempotent')
  })

  it('accepts only a higher projection version', () => {
    expect(decideBillingProjectionWrite(PROJECTION, { ...PROJECTION, version: 8 })).toBe('apply')
    expect(() => decideBillingProjectionWrite(PROJECTION, { ...PROJECTION, version: 6 })).toThrow(
      new BillingProjectionWriteError('stale_version')
    )
  })

  it('rejects different state under a reused version', () => {
    expect(() =>
      decideBillingProjectionWrite(PROJECTION, { ...PROJECTION, effectivePlan: 'scale' })
    ).toThrow(new BillingProjectionWriteError('version_conflict'))
  })

  it('rejects a valid projection bound to another workspace before any write', async () => {
    const previous = process.env.QUACKBACK_INSTANCE_ID
    process.env.QUACKBACK_INSTANCE_ID = 'inst_acme'
    try {
      await expect(writeBillingProjection('inst_other', PROJECTION)).rejects.toMatchObject({
        code: 'workspace_mismatch',
      })
    } finally {
      if (previous === undefined) delete process.env.QUACKBACK_INSTANCE_ID
      else process.env.QUACKBACK_INSTANCE_ID = previous
    }
  })
})

describe('projected commercial state', () => {
  it('enables cloud UX only from a valid projection', () => {
    const cloud = resolveCloudConfig(
      { enabled: true, projection: PROJECTION },
      new Date('2026-08-14T23:59:59.999Z')
    )
    expect(cloud).toMatchObject({
      enabled: true,
      plan: 'pro',
      trialActive: true,
      canUpgrade: true,
      canManageBilling: false,
    })
    expect(resolveCloudConfig({ enabled: true })).toMatchObject({
      enabled: false,
      canUpgrade: false,
      canManageBilling: false,
    })
  })

  it('falls back to Free at the exact projected expiry instant', () => {
    const before = resolveCloudConfig(
      { enabled: true, projection: PROJECTION },
      new Date('2026-08-14T23:59:59.999Z')
    )
    const atExpiry = resolveCloudConfig(
      { enabled: true, projection: PROJECTION },
      new Date('2026-08-15T00:00:00.000Z')
    )
    expect(before.plan).toBe('pro')
    expect(before.entitlements.customDomain).toBe(true)
    expect(atExpiry.plan).toBe('free')
    expect(atExpiry.entitlements).toEqual({})
    expect(atExpiry.trialActive).toBe(false)
    expect(atExpiry.trialExpiresAt).toBe(PROJECTION.trialExpiresAt)
  })

  it('does not keep a Trial badge after a mid-trial purchase', () => {
    const cloud = resolveCloudConfig(
      {
        enabled: true,
        projection: { ...PROJECTION, subscriptionStatus: 'active', planLimitsExpireAt: null },
      },
      new Date('2026-08-14T12:00:00.000Z')
    )
    expect(cloud.trialActive).toBe(false)
    expect(cloud.plan).toBe('pro')
  })
})
