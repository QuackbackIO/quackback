/**
 * Runs the sign-in library's own generic OAuth plugin over configs from
 * `buildGenericOAuthConfigs`, so the nonce setting is proved against the code
 * that actually verifies the ID token. Asserting only on our config flag would
 * stay green if the library renamed or ignored it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { genericOAuth } from 'better-auth/plugins'
import { buildGenericOAuthConfigs } from '../build-oauth-configs'

const issuer = 'https://idp.example'
const discoveryUrl = `${issuer}/.well-known/openid-configuration`

type LibraryProvider = {
  requiresIdTokenNonce?: boolean
  getUserInfo: (tokens: {
    idToken?: string
    accessToken?: string
    expectedIdTokenNonce?: string
  }) => Promise<{ user: { email?: string } } | null>
}

let signingKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  signingKey = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)
  jwk.kid = 'key-1'
  jwk.alg = 'RS256'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === discoveryUrl) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          id_token_signing_alg_values_supported: ['RS256'],
        })
      }
      if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] })
      return new Response('not found', { status: 404 })
    })
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
})

async function providerFor(row: Record<string, unknown>): Promise<LibraryProvider> {
  const [config] = await buildGenericOAuthConfigs({
    providers: [
      {
        id: 'idp_1',
        registrationId: 'oidc_1',
        enabled: true,
        autoCreateUsers: true,
        clientId: 'client-1',
        discoveryUrl,
        ...row,
      },
    ] as never,
    creds: async () => ({ clientSecret: 'secret' }),
    tierAllowsOidc: true,
  })
  const plugin = genericOAuth({ config: [config] as never })
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const initialised = (await plugin.init!({
    socialProviders: [],
    logger,
    baseURL: 'https://app.example',
  } as never)) as { context: { socialProviders: LibraryProvider[] } }
  return initialised.context.socialProviders[0]
}

function signIdToken(claims: Record<string, unknown>, key: CryptoKey = signingKey) {
  return new SignJWT({ email: 'you@example.com', email_verified: true, name: 'You', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .setIssuer(issuer)
    .setAudience('client-1')
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

describe('ID token nonce binding in the sign-in library', () => {
  it('rejects an ID token that leaves out the nonce, by default', async () => {
    const provider = await providerFor({})
    expect(provider.requiresIdTokenNonce).toBe(true)
    const info = await provider.getUserInfo({
      idToken: await signIdToken({}),
      accessToken: 'at',
      expectedIdTokenNonce: 'sent-nonce',
    })
    expect(info).toBeNull()
  })

  it('accepts the same token for a provider set to not use a nonce', async () => {
    const provider = await providerFor({ idTokenNonce: 'off' })
    expect(provider.requiresIdTokenNonce).toBe(false)
    const info = await provider.getUserInfo({ idToken: await signIdToken({}), accessToken: 'at' })
    expect(info?.user.email).toBe('you@example.com')
  })

  it('still rejects a token signed by another key with the nonce off', async () => {
    // Turning the nonce off must remove the echo check only, never the
    // signature, issuer and audience checks.
    const provider = await providerFor({ idTokenNonce: 'off' })
    const { privateKey: otherKey } = await generateKeyPair('RS256', { extractable: true })
    const info = await provider.getUserInfo({
      idToken: await signIdToken({}, otherKey),
      accessToken: 'at',
    })
    expect(info).toBeNull()
  })
})
