/**
 * The handoff's server-to-server verify request, sent to a real Better Auth
 * instance with its origin check on. Better Auth skips that check under
 * NODE_ENV=test unless `disableOriginCheck` is set explicitly, so the other
 * handoff tests, which mock the verify response, cannot see it.
 *
 * The incoming request carries portal-host cookies throughout: a verify
 * request that picks them up is refused with 403 MISSING_OR_NULL_ORIGIN.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { oneTimeToken } from 'better-auth/plugins'

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: vi.fn(),
  getRequestHeaders: () => new Headers({ cookie: 'cf_clearance=x; theme=dark' }),
}))

const BASE_URL = 'http://localhost:3000'

function makeAuth() {
  return betterAuth({
    baseURL: BASE_URL,
    secret: 'test-secret-test-secret-test-secret-0',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    advanced: { disableOriginCheck: false },
    plugins: [oneTimeToken()],
  })
}
type Auth = ReturnType<typeof makeAuth>

async function mintOtt(auth: Auth): Promise<string> {
  const signUp = await auth.api.signUpEmail({
    body: { email: 'visitor@example.com', password: 'password-123456', name: 'Visitor' },
    returnHeaders: true,
  })
  const cookie = signUp.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const { token } = await auth.api.generateOneTimeToken({ headers: new Headers({ cookie }) })
  return token
}

/** Serve every fetch from `auth`, the way the verify call reaches the app. */
function serveFetchFrom(auth: Auth) {
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
    auth.handler(new Request(input, init))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('widget handoff verify request', () => {
  it('installs the session for a visitor who already has cookies on the portal', async () => {
    const auth = makeAuth()
    const ott = await mintOtt(auth)
    serveFetchFrom(auth)

    const { verifyHandoffToken } = await import('../auth.widget-handoff')
    const res = await verifyHandoffToken(BASE_URL, ott)

    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().join('\n')).toContain('better-auth.session_token=')
    const body = (await res.json()) as { session?: { id?: string }; user?: { id?: string } }
    expect(body.session?.id).toBeTruthy()
    expect(body.user?.id).toBeTruthy()
  })

  it('a verify request carrying a cookie but no Origin is refused', async () => {
    // Why the browser's cookies must stay off the verify call.
    const auth = makeAuth()
    const ott = await mintOtt(auth)

    const res = await auth.handler(
      new Request(`${BASE_URL}/api/auth/one-time-token/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'theme=dark' },
        body: JSON.stringify({ token: ott }),
      })
    )

    expect(res.status).toBe(403)
    expect(((await res.json()) as { code?: string }).code).toBe('MISSING_OR_NULL_ORIGIN')
  })
})
