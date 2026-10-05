/**
 * Runs the sign-in library's own generic OAuth plugin over configs from
 * `buildGenericOAuthConfigs`, and reads the redirect URI off what the library
 * actually produces: the authorize URL it builds and the token request it
 * sends. An IdP that matches redirect URIs exactly rejects the authorize
 * request when this differs from the registered URL, and rejects the code
 * exchange when the two requests disagree with each other, so both are
 * asserted rather than our config flag.
 *
 * The library is handed its own default (`<base>/api/auth/callback/<id>`) as
 * the per-request URI, exactly as its sign-in and callback routes do. A
 * legacy provider only reads legacy if our config overrides that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { genericOAuth } from 'better-auth/plugins'
import { buildGenericOAuthConfigs } from '../build-oauth-configs'

const BASE_URL = 'https://feedback.example.com'
const AUTH_BASE = `${BASE_URL}/api/auth`
const TOKEN_URL = 'https://idp.example/token'

type LibraryProvider = {
  createAuthorizationURL: (data: {
    state: string
    codeVerifier: string
    redirectURI: string
    scopes?: string[]
  }) => Promise<URL>
  validateAuthorizationCode: (data: {
    code: string
    codeVerifier?: string
    redirectURI: string
  }) => Promise<unknown>
}

let tokenRequests: URLSearchParams[] = []

beforeEach(() => {
  tokenRequests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === TOKEN_URL) {
        const body = input instanceof Request ? await input.text() : String(init?.body ?? '')
        tokenRequests.push(new URLSearchParams(body))
        return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 })
      }
      return new Response('not found', { status: 404 })
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function providerFor(row: Record<string, unknown>): Promise<LibraryProvider> {
  const [config] = await buildGenericOAuthConfigs({
    providers: [
      {
        id: 'idp_1',
        registrationId: 'sso',
        enabled: true,
        autoCreateUsers: true,
        clientId: 'client-1',
        authorizationUrl: 'https://idp.example/authorize',
        tokenUrl: TOKEN_URL,
        ...row,
      },
    ] as never,
    creds: async () => ({ clientSecret: 'secret' }),
    tierAllowsOidc: true,
    baseUrl: BASE_URL,
  })
  const plugin = genericOAuth({ config: [config] as never })
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const initialised = (await plugin.init!({
    socialProviders: [],
    logger,
    baseURL: AUTH_BASE,
  } as never)) as { context: { socialProviders: LibraryProvider[] } }
  return initialised.context.socialProviders[0]
}

/** What the library passes as the per-request URI on sign-in and callback. */
const LIBRARY_DEFAULT = `${AUTH_BASE}/callback/sso`

async function redirectUrisSent(provider: LibraryProvider) {
  const authorize = await provider.createAuthorizationURL({
    state: 'state-1',
    codeVerifier: 'verifier-'.padEnd(50, 'x'),
    redirectURI: LIBRARY_DEFAULT,
  })
  await provider.validateAuthorizationCode({
    code: 'code-1',
    codeVerifier: 'verifier-'.padEnd(50, 'x'),
    redirectURI: LIBRARY_DEFAULT,
  })
  expect(tokenRequests).toHaveLength(1)
  return {
    authorize: authorize.searchParams.get('redirect_uri'),
    token: tokenRequests[0]!.get('redirect_uri'),
  }
}

describe('OIDC redirect URI sent by sign-in', () => {
  it('sends the legacy URI on authorize and token exchange for a legacy provider', async () => {
    const sent = await redirectUrisSent(await providerFor({ redirectStyle: 'legacy' }))
    expect(sent.authorize).toBe(`${BASE_URL}/api/auth/oauth2/callback/sso`)
    expect(sent.token).toBe(`${BASE_URL}/api/auth/oauth2/callback/sso`)
  })

  it('treats a provider with no recorded style as legacy', async () => {
    const sent = await redirectUrisSent(await providerFor({}))
    expect(sent.authorize).toBe(`${BASE_URL}/api/auth/oauth2/callback/sso`)
    expect(sent.token).toBe(`${BASE_URL}/api/auth/oauth2/callback/sso`)
  })

  it('sends the current URI on authorize and token exchange for a current provider', async () => {
    const sent = await redirectUrisSent(await providerFor({ redirectStyle: 'current' }))
    expect(sent.authorize).toBe(`${BASE_URL}/api/auth/callback/sso`)
    expect(sent.token).toBe(`${BASE_URL}/api/auth/callback/sso`)
  })
})
