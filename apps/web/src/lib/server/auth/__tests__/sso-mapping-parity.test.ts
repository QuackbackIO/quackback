import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { buildGenericOAuthConfigs } from '../build-oauth-configs'
import { runHandshake } from '../sso-test-handshake'
import { claimMappingFor, identityMappingFor } from '@/lib/shared/oidc-claim-mapping'
import { finishBinding, replayClaimMapping } from '@/lib/shared/sso-claim-binder'
import { finalizeProfileOutcome } from '@/lib/shared/sso-profile-outcome'
import { resolveSsoRoleMatch } from '@/lib/shared/resolve-sso-role'
import { planClaimAttributeWrites } from '@/lib/shared/plan-claim-attribute-writes'
import { isReplayableCapture } from '@/lib/shared/sso-test-capture'
import { previewClaimMapping } from '@/lib/shared/sso-mapping-preview'
import {
  MAPPING_WORLDS,
  type MappingWorld,
} from '@/lib/shared/__tests__/fixtures/sso-mapping-worlds'

vi.mock('@/lib/server/content/ssrf-guard', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/content/ssrf-guard')>()
  return { ...actual, safeFetch: vi.fn() }
})

import { safeFetch } from '@/lib/server/content/ssrf-guard'
const safeFetchMock = vi.mocked(safeFetch)

beforeEach(() => {
  safeFetchMock.mockReset()
})

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'idp_abc',
    registrationId: 'oidc_abc',
    enabled: true,
    autoCreateUsers: true,
    discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
    userInfoUrl: 'https://idp.example/userinfo',
    ...over,
  }
}

async function signIdToken(claims: Record<string, unknown>, privateKey: CryptoKey) {
  const jwt = new SignJWT({ ...claims, nonce: 'nonce789' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://idp.example')
    .setAudience('cid')
    .setIssuedAt()
    .setExpirationTime('5m')
  if (typeof claims.sub === 'string') jwt.setSubject(claims.sub)
  return jwt.sign(privateKey)
}

async function productionProfile(world: MappingWorld, idToken: string) {
  const configs = await buildGenericOAuthConfigs({
    providers: [row({ claimMapping: world.mapping })] as never,
    creds: async () => ({ clientId: 'c', clientSecret: 's' }),
    tierAllowsOidc: true,
    fetchUserInfo: async () => world.userinfo,
  })
  return configs[0].getUserInfo?.({ idToken, accessToken: 'at' })
}

async function testHandshake(world: MappingWorld, idToken: string, publicJwk: JsonWebKey) {
  const issuer = 'https://idp.example'
  safeFetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        issuer,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
      }),
      { status: 200 }
    )
  )
  safeFetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ id_token: idToken, access_token: 'at', token_type: 'Bearer' }), {
      status: 200,
    })
  )
  safeFetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
  )
  safeFetchMock.mockResolvedValue(new Response(JSON.stringify(world.userinfo), { status: 200 }))

  return runHandshake({
    state: 'state123',
    code: 'authcode456',
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    clientId: 'cid',
    clientSecret: 'csecret',
    redirectUri: 'https://qb/api/auth/oauth2/callback/oidc_abc',
    codeVerifier: 'test-code-verifier',
    expectedNonce: 'nonce789',
    expectedState: 'state123',
    identityMapping: identityMappingFor(world.mapping),
    claimMapping: claimMappingFor(world.mapping),
    registrationId: 'oidc_abc',
  })
}

describe('production test and preview agree on identity role and People mappings', () => {
  it.each(MAPPING_WORLDS)('$name', async (world) => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    publicJwk.kid = 'test-key'
    publicJwk.alg = 'RS256'
    const idToken = await signIdToken(world.idToken, privateKey)

    const profile = await productionProfile(world, idToken)
    const handshake = await testHandshake(world, idToken, publicJwk)
    if (!handshake.ok)
      throw new Error(`${world.name}: handshake ${handshake.stage}: ${handshake.hint}`)
    expect(isReplayableCapture(handshake.capture!)).toBe(true)

    const bound = finishBinding(
      replayClaimMapping(
        {
          mapping: identityMappingFor(world.mapping),
          requiredClaimPaths: [
            ...(claimMappingFor(world.mapping).attributes?.map ?? []).map((e) => e.claimPath),
            ...(claimMappingFor(world.mapping).role?.claimPath
              ? [claimMappingFor(world.mapping).role!.claimPath]
              : []),
          ],
          wantImage: true,
        },
        handshake.capture!.replay.sources
      )
    )
    const preview = finalizeProfileOutcome(bound, { allowMissingEmail: false })
    const mapping = claimMappingFor(world.mapping)

    expect(profile?.id).toBe(world.expect.id)
    expect(handshake.identity?.id).toBe(world.expect.id)
    expect(preview.id).toBe(world.expect.id)

    expect(String(profile?.email).toLowerCase()).toBe(world.expect.email)
    expect(handshake.mappingOutcome?.email).toBe(world.expect.email)
    expect(preview.email).toBe(world.expect.email)

    expect(profile?.name).toBe(world.expect.name)
    expect(preview.name).toBe(world.expect.name)

    expect(handshake.identity?.sources.id).toBe(world.expect.idSource)
    expect(handshake.identity?.sources.email).toBe(world.expect.emailSource)
    expect(bound.provenance.email?.path).toBe(world.expect.emailPath)

    const accepted = preview.acceptedClaims
    const roleMatch = resolveSsoRoleMatch(accepted, mapping.role)
    if (world.expect.role) {
      expect(roleMatch).toEqual(world.expect.role)
    } else {
      expect(roleMatch).toBeNull()
    }

    if (world.expect.people && mapping.attributes) {
      const plan = planClaimAttributeWrites({
        claims: accepted,
        mapping: mapping.attributes,
        existing: {},
        definitions: world.definitions,
      })
      expect(plan.valid).toEqual(world.expect.people)
    }

    const helper = previewClaimMapping({
      draft: world.mapping,
      capture: handshake.capture!,
      definitions: world.definitions,
      providerPolicy: {
        autoCreateUsers: true,
        autoProvisionRole: 'member',
        registrationId: 'oidc_abc',
      },
    })
    expect(helper.status === 'ready' || helper.status === 'mapping_failed').toBe(true)
    expect(helper.identity?.id).toBe(world.expect.id)
    expect(helper.identity?.email).toBe(world.expect.email)
    expect(helper.roleMatch).toEqual(world.expect.role ?? null)
    if (world.expect.people) {
      expect(helper.peoplePlan?.valid).toEqual(world.expect.people)
    }
  })
})

describe('parity boundaries', () => {
  it('new source absent from capture requires retest', () => {
    const snapshots: import('@/lib/shared/oidc-claim-mapping').SourceSnapshot[] = [
      { source: 'idToken', claims: { sub: 's', email: 'e@x.com', name: 'N' } },
    ]
    expect(snapshots.some((s) => s.source === 'accessTokenJwt')).toBe(false)
    const bound = finishBinding(
      replayClaimMapping(
        { mapping: { sources: ['idToken', 'userinfo', 'accessTokenJwt'] }, exhaustive: true },
        snapshots
      )
    )
    expect(bound.sourceAvailability.accessTokenJwt).toBe('absent')
  })

  it('draft mapping fetches recorded userinfo only when production would', () => {
    const snapshots = [
      { source: 'idToken' as const, claims: { sub: 's', email: 'e@x.com', name: 'N' } },
      { source: 'userinfo' as const, claims: { sub: 's', department: 'Eng' } },
    ]
    const withoutPath = finishBinding(replayClaimMapping({ mapping: {} }, snapshots))
    expect(withoutPath.acceptedClaims.department).toBeUndefined()
    const withPath = finishBinding(
      replayClaimMapping({ mapping: {}, requiredClaimPaths: ['department'] }, snapshots)
    )
    expect(withPath.acceptedClaims.department).toBe('Eng')
  })
})
