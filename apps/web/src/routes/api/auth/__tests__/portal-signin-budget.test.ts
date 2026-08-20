/**
 * What a sign-in request costs, and what it costs to be told no.
 *
 * `POST /api/auth/portal-signin` meters every address before it decides
 * anything, so that asking about an address the workspace refuses costs exactly
 * what asking about one it accepts costs. That property is what makes the
 * uniform 200 worth anything: an answer that never varies is still an oracle if
 * one branch runs out of budget three requests before the other.
 *
 * The sibling suite (`portal-signin-indistinguishable.test.ts`) compares the
 * two worlds one request at a time, with a limiter that always says yes. It
 * cannot see this, because the difference only appears once the bucket is real
 * and the requests are repeated.
 *
 * ## The double that hid it
 *
 * `auth.api.sendVerificationOTP` was stubbed as a function that returns. The
 * real one does not: `auth.api.*` dispatches through `dispatchAuthEndpoint`,
 * which runs `hooks.before` — this app's own `handleSignInPreCheck` — and
 * rethrows whatever it throws. So the send half spends the SAME
 * `signin:magiclink:<ip>:<address>` bucket a second time, and a limiter that
 * refuses there arrives as an exception out of the middle of a request that had
 * already passed its own check.
 *
 * So the auth double here is not a stub. It runs the real before-hook chain,
 * with each endpoint's own `path`, exactly as the dispatcher does — including
 * the path-less endpoint, which reaches the chain under a placeholder no gate
 * recognises and therefore passes through untouched. Nothing in the double
 * knows which endpoint production picks; that choice is the thing under test.
 *
 * `auth/__tests__/otp-endpoint-hooks.test.ts` is the other half of that claim:
 * it reads both paths off the real Better-Auth build, so this file is not free
 * to invent them.
 *
 * The bucket store is real arithmetic over an in-memory map. `rate-bucket.ts`
 * and `signin-rate-limit.ts` — the limits, the windows, the fail-open
 * direction — are the real modules; only the rows are held in memory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APIError } from 'better-auth/api'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  userFindFirst: vi.fn(),
  principalFindFirst: vi.fn(),
  invitationFindFirst: vi.fn(),
  settingsFindFirst: vi.fn(async () => ({ name: 'Acme', logoKey: null })),
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
  createVerificationValue: vi.fn(async () => ({ id: 'v_1' })),
  sendMagicLinkEmail: vi.fn(async () => undefined),
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
  /** Post-increment counts, per bucket key, for the current window. */
  buckets: new Map<string, number>(),
  /** When set, the mint refuses the way a limiter below this handler would. */
  throttleTheMint: false,
}))

// The store, and only the store. One map entry per bucket key; no expiry is
// modelled because no test here spans a window.
vi.mock('@/lib/server/kv/pg-kv', () => ({
  incrementRateBucket: async (spec: { key: string }) => {
    const next = (hoisted.buckets.get(spec.key) ?? 0) + 1
    hoisted.buckets.set(spec.key, next)
    return { count: next }
  },
  incrementRateBuckets: async (specs: readonly { key: string }[]) =>
    specs.map((spec) => {
      const next = (hoisted.buckets.get(spec.key) ?? 0) + 1
      hoisted.buckets.set(spec.key, next)
      return { count: next }
    }),
  rateBucketRetryAfter: async (spec: { windowSeconds: number }) => spec.windowSeconds,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      settings: { findFirst: () => hoisted.settingsFindFirst() },
      user: { findFirst: (...a: unknown[]) => hoisted.userFindFirst(...a) },
      principal: { findFirst: (...a: unknown[]) => hoisted.principalFindFirst(...a) },
      invitation: { findFirst: (...a: unknown[]) => hoisted.invitationFindFirst(...a) },
    },
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))

vi.mock('@/lib/server/domains/principals/bootstrap-admin', () => ({
  findHumanAdmin: (...a: unknown[]) => hoisted.findHumanAdmin(...a),
  isOpenToBootstrapClaim: (...a: unknown[]) => hoisted.isOpenToBootstrapClaim(...a),
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendMagicLinkEmail: hoisted.sendMagicLinkEmail,
  sendSignupNotAllowedEmail: hoisted.sendSignupNotAllowedEmail,
}))

vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://acme.quackback.io', trustedProxyHops: 1 },
}))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: async () => undefined }))
vi.mock('@/lib/server/auth/widget-rate-limit', () => ({
  checkAnonMintRateLimit: async () => ({ allowed: true }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'x-forwarded-for': IP }),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => [],
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: async () => new Set<string>(),
}))

const IP = '203.0.113.7'

// The before-hook chain, run the way `dispatchAuthEndpoint` runs it. Loaded
// after the mocks above so it sees them; `signin-rate-limit` and `rate-bucket`
// are NOT mocked, so this spends the real budget.
const { handleSignInPreCheck } = await import('@/lib/server/auth/hooks')

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`)
  }
}

/**
 * One `auth.api.*` dispatch: run `hooks.before` for the endpoint's own path,
 * then the handler. An endpoint declared without a path reaches the chain under
 * the placeholder `'/'`, which no gate recognises — see
 * `auth/__tests__/otp-endpoint-hooks.test.ts`, which reads both paths off the
 * real library so this file does not have to guess them.
 */
async function dispatch(path: string, email: string): Promise<void> {
  await handleSignInPreCheck({
    path,
    body: { email },
    redirect: (url: string) => new Redirected(url),
  })
}

vi.mock('@/lib/server/auth/index', () => ({
  getAuth: vi.fn(async () => ({
    api: {
      sendVerificationOTP: async ({ body }: { body: { email: string } }) => {
        await dispatch('/email-otp/send-verification-otp', body.email)
        return { success: true }
      },
      createVerificationOTP: async ({ body }: { body: { email: string } }) => {
        await dispatch('/', body.email)
        // The real class, thrown the way Better-Auth's middleware throws it —
        // a hand-rolled look-alike would pass a handler that recognised the
        // wrong shape.
        if (hoisted.throttleTheMint) {
          throw new APIError(
            'TOO_MANY_REQUESTS',
            { code: 'rate_limited', message: 'Too many attempts.' },
            { 'Retry-After': '42' }
          )
        }
        return '123456'
      },
    },
    $context: { internalAdapter: { createVerificationValue: hoisted.createVerificationValue } },
  })),
  getOTP: vi.fn(() => '123456'),
}))

const { handlePortalSignin } = await import('../portal-signin')

/** Held by a user row: a sign-in, which the workspace allows. */
const KNOWN = 'regular@acme.example'
/** No account, no invitation: the address the workspace refuses. */
const STRANGER = 'stranger@evil.example'

function post(email: string): Request {
  return new Request('https://acme.quackback.io/api/auth/portal-signin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
    body: JSON.stringify({ email, callbackURL: '/' }),
  })
}

async function ask(email: string): Promise<Response> {
  hoisted.userFindFirst.mockResolvedValue(email === KNOWN ? { id: 'user_1' } : null)
  return handlePortalSignin(post(email))
}

/** `n` requests for the same address, as a list of status codes. */
async function statuses(email: string, n: number): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((await ask(email)).status)
  return out
}

const tupleKey = (email: string) => `signin:magiclink:${IP}:${email}`

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.buckets.clear()
  hoisted.throttleTheMint = false
  // An owner exists, nobody can claim the workspace by arriving, and its admin
  // has closed self-service sign-ups: the only workspace where the per-address
  // answer differs at all.
  hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: { openSignup: false } })
  hoisted.userFindFirst.mockResolvedValue(null)
  hoisted.principalFindFirst.mockResolvedValue(null)
  hoisted.invitationFindFirst.mockResolvedValue(null)
  hoisted.findHumanAdmin.mockResolvedValue({ id: 'principal_owner' })
  hoisted.isOpenToBootstrapClaim.mockResolvedValue(false)
  hoisted.settingsFindFirst.mockResolvedValue({ name: 'Acme', logoKey: null })
})

describe('POST /api/auth/portal-signin — the budget is the same for both answers', () => {
  // The oracle, read off the clock rather than the status line: if one address
  // runs out sooner than another, repeating the question tells you which is
  // which. Compared to each other, never to a literal, so "both are broken the
  // same way" cannot pass for agreement.
  it('exhausts the budget at the same request for both addresses', async () => {
    const known = await statuses(KNOWN, 5)
    hoisted.buckets.clear()
    hoisted.throttleTheMint = false
    const stranger = await statuses(STRANGER, 5)

    expect(stranger).toEqual(known)
  })

  // Stated directly: one request, one token, whichever answer it gets.
  it('spends one token per request, whichever answer it gets', async () => {
    await ask(KNOWN)
    const spentOnKnown = hoisted.buckets.get(tupleKey(KNOWN))

    await ask(STRANGER)
    const spentOnStranger = hoisted.buckets.get(tupleKey(STRANGER))

    expect(spentOnKnown).toBe(1)
    expect(spentOnStranger).toBe(1)
  })

  // "Didn't get the email? Resend" — the second attempt inside the window, by
  // somebody who genuinely holds an account here.
  it('sends again for a real user asking twice', async () => {
    const first = await ask(KNOWN)
    const second = await ask(KNOWN)

    expect([first.status, second.status]).toEqual([200, 200])
    expect(hoisted.sendMagicLinkEmail).toHaveBeenCalledTimes(2)
  })
})

describe('POST /api/auth/portal-signin — a refusal by the limiter is a 429', () => {
  it('answers 429 with Retry-After once the budget is gone', async () => {
    await statuses(KNOWN, 3)

    const throttled = await ask(KNOWN)

    expect(throttled.status).toBe(429)
    expect(throttled.headers.get('Retry-After')).toBe(String(15 * 60))
  })

  // The status that must never appear: a limiter saying no is a known,
  // expected answer, and reporting it as a server fault loses the Retry-After
  // and tells the person nothing they can act on.
  it('never answers 500 while the limiter is the only thing refusing', async () => {
    const seen = await statuses(KNOWN, 6)

    expect(seen).not.toContain(500)
  })

  // The control: the limiter really is what stops it, rather than the suite
  // running out of some other resource. A different address has its own bucket
  // and is still served after the first one is exhausted.
  it('leaves a different address its own budget', async () => {
    await statuses(KNOWN, 4)

    const other = await ask('someone-else@acme.example')

    expect(other.status).toBe(200)
  })

  // A limiter reached BELOW this handler raises rather than returns, so the
  // handler has to recognise it. This is the shape that reached the person as
  // a 500 with no `Retry-After`, and it stays covered even now that nothing on
  // this path spends the budget twice: the mapping is what keeps a future
  // downstream limiter from arriving as a fault.
  it('answers 429 when the refusal is raised from below', async () => {
    hoisted.throttleTheMint = true

    const res = await ask(KNOWN)

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
  })

  // And it says the same thing the check above this one says, so which limiter
  // refused is not readable from the answer.
  it('answers a raised refusal in the same shape as its own', async () => {
    await statuses(KNOWN, 3)
    const fromOwnCheck = await ask(KNOWN)

    hoisted.buckets.clear()
    hoisted.throttleTheMint = true
    const fromBelow = await ask(KNOWN)

    expect(fromBelow.status).toBe(fromOwnCheck.status)
    expect(await fromBelow.text()).toBe(await fromOwnCheck.text())
  })
})
