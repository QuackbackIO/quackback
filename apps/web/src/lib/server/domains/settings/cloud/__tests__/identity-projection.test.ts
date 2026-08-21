import { exportSPKI, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  IDENTITY_PROJECTION_AUDIENCE,
  IDENTITY_PROJECTION_TYPE,
  verifyIdentityProjectionToken,
} from '../identity-projection.signature'
import { parseIdentityProjection, type IdentityProjection } from '../identity-projection'
import {
  decideIdentityProjectionWrite,
  IdentityProjectionWriteError,
  writeIdentityProjection,
} from '../identity-projection.write'

const PROJECTION: IdentityProjection = {
  version: 4,
  displayName: 'Acme Feedback',
  canonicalOrigin: 'https://acme.quackback.co.uk',
  platformHostname: 'acme.quackback.co.uk',
  customDomains: [
    {
      hostname: 'feedback.acme.com',
      readiness: 'pending',
      isPrimary: false,
      updatedAt: '2026-08-14T12:00:00.000Z',
    },
  ],
  updatedAt: '2026-08-14T12:00:00.000Z',
}

async function signedToken(
  workspaceKey: string,
  projection: IdentityProjection,
  privateKey: CryptoKey
): Promise<string> {
  return new SignJWT({ workspaceKey, identityProjection: projection })
    .setProtectedHeader({ alg: 'EdDSA', typ: IDENTITY_PROJECTION_TYPE })
    .setIssuer('quackback-control-plane')
    .setAudience(IDENTITY_PROJECTION_AUDIENCE)
    .setIssuedAt()
    .sign(privateKey)
}

describe('identity projection validation', () => {
  it('accepts only the customer-safe allowlisted shape', () => {
    expect(parseIdentityProjection(PROJECTION)).toEqual(PROJECTION)
    expect(parseIdentityProjection(PROJECTION)).not.toBeNull()
    expect(parseIdentityProjection(null)).toBeNull()
    expect(parseIdentityProjection({ ...PROJECTION, platformHostname: null })).toEqual({
      ...PROJECTION,
      platformHostname: null,
    })
    expect(
      parseIdentityProjection({ ...PROJECTION, cloudflareHostnameId: 'provider-secret' })
    ).toBeNull()
    expect(
      parseIdentityProjection({
        ...PROJECTION,
        customDomains: [{ ...PROJECTION.customDomains[0], validationToken: 'secret' }],
      })
    ).toBeNull()
  })

  it('verifies signature, audience, type and workspace binding', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
    const publicPem = await exportSPKI(publicKey)
    const token = await signedToken('inst_acme', PROJECTION, privateKey)
    await expect(verifyIdentityProjectionToken(token, publicPem)).resolves.toEqual({
      workspaceKey: 'inst_acme',
      projection: PROJECTION,
    })
  })
})

describe('identity projection monotonicity', () => {
  it('accepts identical replay and only a higher changed version', () => {
    expect(decideIdentityProjectionWrite(PROJECTION, { ...PROJECTION })).toBe('idempotent')
    expect(decideIdentityProjectionWrite(PROJECTION, { ...PROJECTION, version: 5 })).toBe('apply')
    expect(() => decideIdentityProjectionWrite(PROJECTION, { ...PROJECTION, version: 3 })).toThrow(
      new IdentityProjectionWriteError('stale_version')
    )
    expect(() =>
      decideIdentityProjectionWrite(PROJECTION, { ...PROJECTION, displayName: 'Other' })
    ).toThrow(new IdentityProjectionWriteError('version_conflict'))
  })

  it('rejects another workspace before touching local state', async () => {
    const previous = process.env.QUACKBACK_INSTANCE_ID
    process.env.QUACKBACK_INSTANCE_ID = 'inst_acme'
    try {
      await expect(writeIdentityProjection('inst_other', PROJECTION)).rejects.toMatchObject({
        code: 'workspace_mismatch',
      })
    } finally {
      if (previous === undefined) delete process.env.QUACKBACK_INSTANCE_ID
      else process.env.QUACKBACK_INSTANCE_ID = previous
    }
  })
})
