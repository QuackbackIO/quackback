/**
 * Every caller of the signup policy, pinned to the door it actually is.
 *
 * `isAccountCreationAllowed(email, audience)` takes the door as an argument
 * with no default, and three production paths supply it. Nothing checked which
 * one they supplied: the suite that exercises the two doors calls the policy
 * directly and never a caller, and the suites that drive the callers used a
 * workspace carrying only `authConfig.openSignup` — a fixture on which both
 * doors return the same answer by construction, so every caller could have been
 * passing either one and no test would have moved.
 *
 * That is the whole hazard this file exists for, so the fixture here is built
 * the opposite way: BOTH keys are stored and they DISAGREE. A caller reading
 * the wrong one gets the wrong answer, and gets it in both directions —
 * `portal open, team closed` catches a caller that drifted to the team, and
 * `portal closed, team open` catches one that would have been right by accident
 * on the first fixture alone.
 *
 * The three cases below are three different SEAMS onto the same decision, and
 * that is deliberate: what is at risk is not the policy (already covered) but
 * the one-word argument at each call site, and the only way to see that word is
 * to run the caller that writes it. Each case asserts on the caller's own
 * observable — a redirect, an email, an abort — never on the policy's return.
 *
 * `signup-policy-audience.db.test.ts` is the other half: it decides WHICH
 * STORED COLUMN each door reads, against a real row. This file takes that as
 * settled and asks which door each caller knocks on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  userFindFirst: vi.fn(),
  principalFindFirst: vi.fn(),
  invitationFindFirst: vi.fn(),
  settingsFindFirst: vi.fn(async () => ({ name: 'Acme', logoKey: null })),
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
  createVerificationValue: vi.fn(async (_row: { identifier: string; value: string }) => ({
    id: 'v_1',
  })),
  createVerificationOTP: vi.fn(async () => '123456'),
  sendVerificationOTP: vi.fn(async () => undefined),
  sendMagicLinkEmail: vi.fn(async () => undefined),
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
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

// The two bootstrap facts, stubbed at their own boundary: they are decided by
// SQL this suite has no connection for, and `signup-policy.db.test.ts` owns
// them. The policy itself stays REAL — a stubbed policy would prove only that
// a stand-in was called, and the argument it was called with is the subject.
vi.mock('@/lib/server/domains/principals/bootstrap-admin', () => ({
  findHumanAdmin: (...a: unknown[]) => hoisted.findHumanAdmin(...a),
  isOpenToBootstrapClaim: (...a: unknown[]) => hoisted.isOpenToBootstrapClaim(...a),
}))

vi.mock('../index', () => ({
  getAuth: vi.fn(async () => ({
    api: {
      createVerificationOTP: hoisted.createVerificationOTP,
      sendVerificationOTP: hoisted.sendVerificationOTP,
    },
    $context: { internalAdapter: { createVerificationValue: hoisted.createVerificationValue } },
  })),
  getOTP: vi.fn(() => '123456'),
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

vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkCredentialSignInRateLimit: async () => ({ allowed: true }),
  checkMagicLinkSendRateLimit: async () => ({ allowed: true }),
}))
vi.mock('@/lib/server/auth/widget-rate-limit', () => ({
  checkAnonMintRateLimit: async () => ({ allowed: true }),
}))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: async () => undefined }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => [],
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: async () => new Set<string>(),
}))

const { handleSignInPreCheck } = await import('../hooks')
const { requestEmailSignin } = await import('../email-signin')
const { guardBetterAuthUserCreation } = await import('../signup-policy')

/** No account, no invitation: the address whose fate the door decides. */
const STRANGER = 'stranger@evil.example'

/**
 * The two worlds. Both keys stored, always disagreeing — a caller reading the
 * team's answer and a caller reading the portal's cannot both be right on
 * either of them.
 */
const PORTAL_OPEN = {
  authConfig: { openSignup: false },
  portalConfig: { openSignup: true },
}
const PORTAL_CLOSED = {
  authConfig: { openSignup: true },
  portalConfig: { openSignup: false },
}

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`)
  }
}

/** Layer B, on a path that would create an account. Did it let the request on? */
async function preCheckAllowed(): Promise<boolean> {
  try {
    await handleSignInPreCheck({
      path: '/sign-in/magic-link',
      body: { email: STRANGER },
      redirect: (url: string) => new Redirected(url),
    })
    return true
  } catch (err) {
    if (err instanceof Redirected && err.url.includes('signup_not_allowed')) return false
    throw err
  }
}

/** The portal sign-in path. A sign-in link means allowed; the refusal notice means refused. */
async function emailSigninAllowed(): Promise<boolean> {
  await requestEmailSignin({ email: STRANGER, callbackURL: '/' })
  const sent = hoisted.sendMagicLinkEmail.mock.calls.length
  const refused = hoisted.sendSignupNotAllowedEmail.mock.calls.length
  expect(sent + refused).toBe(1) // exactly one of the two, either way
  return sent === 1
}

/** The Better-Auth backstop. `undefined` carries on, `false` is the abort. */
async function backstopAllowed(): Promise<boolean> {
  return (
    (await guardBetterAuthUserCreation({ email: STRANGER }, { path: '/sign-in/magic-link' })) ===
    undefined
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.userFindFirst.mockResolvedValue(null)
  hoisted.principalFindFirst.mockResolvedValue(null)
  hoisted.invitationFindFirst.mockResolvedValue(null)
  hoisted.findHumanAdmin.mockResolvedValue({ id: 'principal_owner' })
  hoisted.isOpenToBootstrapClaim.mockResolvedValue(false)
  hoisted.settingsFindFirst.mockResolvedValue({ name: 'Acme', logoKey: null })
})

describe.each([
  {
    name: 'the portal is open and the team is not',
    workspace: PORTAL_OPEN,
    allowed: true,
  },
  {
    name: 'the portal is closed and the team is not',
    workspace: PORTAL_CLOSED,
    allowed: false,
  },
])('$name', ({ workspace, allowed }) => {
  beforeEach(() => {
    hoisted.getWorkspaceSettings.mockResolvedValue(workspace)
  })

  // Layer B, `hooks.ts`. The four gated paths are reachable from the portal
  // dialog and the team login alike, and what settles the audience is what the
  // creation produces: `user.create.after` writes `role: 'user'`.
  it(`the pre-session gate answers ${allowed}`, async () => {
    expect(await preCheckAllowed()).toBe(allowed)
  })

  // `email-signin.ts`, in front of the mint. Its `callbackURL` may point at
  // `/admin` and that still does not make it the team door.
  it(`the portal sign-in path answers ${allowed}`, async () => {
    expect(await emailSigninAllowed()).toBe(allowed)
  })

  // The `user.create.before` backstop, which every Better-Auth account
  // creation passes through.
  it(`the account-creation backstop answers ${allowed}`, async () => {
    expect(await backstopAllowed()).toBe(allowed)
  })
})

/**
 * The control the six cases above rest on. If the two fixtures did not really
 * decide differently, "tracks the portal" would be a statement about a policy
 * that never ran.
 */
describe('the fixture really does separate the two doors', () => {
  it('answers the two doors differently on the same workspace', async () => {
    const { isAccountCreationAllowed } = await import('../signup-policy')
    hoisted.getWorkspaceSettings.mockResolvedValue(PORTAL_OPEN)

    expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(true)
    expect(await isAccountCreationAllowed(STRANGER, 'team')).toBe(false)

    hoisted.getWorkspaceSettings.mockResolvedValue(PORTAL_CLOSED)

    expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(false)
    expect(await isAccountCreationAllowed(STRANGER, 'team')).toBe(true)
  })
})
