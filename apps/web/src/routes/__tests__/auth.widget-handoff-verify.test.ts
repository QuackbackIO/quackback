/**
 * The handoff's server-to-server OTT verify call must succeed for a visitor
 * who already carries cookies on the portal origin. Runs the request against
 * a real Better Auth instance with its origin check enabled (Better Auth
 * skips that check by default under NODE_ENV=test, which hid the bug).
 */
import { describe, it, expect } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { oneTimeToken } from 'better-auth/plugins'
import { buildOttVerifyInit } from '../auth.widget-handoff'

const BASE_URL = 'http://localhost:3000'
const VERIFY_URL = `${BASE_URL}/api/auth/one-time-token/verify`

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

async function mintOtt(auth: ReturnType<typeof makeAuth>): Promise<string> {
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

describe('widget handoff OTT verify request', () => {
  it('carries no cookie header', () => {
    const headers = new Headers(buildOttVerifyInit('tok').headers)
    expect(headers.has('cookie')).toBe(false)
  })

  it('is rejected by Better Auth when the visitor cookie is forwarded', async () => {
    const auth = makeAuth()
    const ott = await mintOtt(auth)
    const res = await auth.handler(
      new Request(VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=old' },
        body: JSON.stringify({ token: ott }),
      })
    )
    expect(res.status).toBe(403)
  })

  it('verifies the OTT and returns a session cookie', async () => {
    const auth = makeAuth()
    const ott = await mintOtt(auth)
    const res = await auth.handler(new Request(VERIFY_URL, buildOttVerifyInit(ott)))
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().join('\n')).toContain('better-auth.session_token=')
    const body = (await res.json()) as { session?: { id?: string } }
    expect(body.session?.id).toBeTruthy()
  })
})
