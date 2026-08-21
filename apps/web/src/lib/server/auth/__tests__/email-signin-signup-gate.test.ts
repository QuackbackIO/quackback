/**
 * The path that hands a stranger a session without ever touching the
 * `hooks.before` chain.
 *
 * `POST /api/auth/portal-signin` calls `requestEmailSignin`, which mints a
 * magic-link verification row through `mintMagicLinkUrl` — a function that
 * deliberately does NOT run the hook chain (rate limit, method toggle,
 * hard-binding), because it also serves invitations and recovery codes where
 * that chain is wrong. It issues the mint and the one-time-code send together,
 * so a hook-layer refusal on the code half rejects the request while leaving a
 * working sign-in link already written. `openSignup` therefore has to be
 * decided in front of the mint, and only a test that drives the REAL mint can
 * see whether it was.
 *
 * So `magic-link-mint` is not mocked here — the sibling suite does that, and
 * that is exactly why the sibling cannot see this. What stands in is the
 * Better-Auth instance the mint writes through, and it stands in as a recorder:
 * `createVerificationValue` captures its argument, so an assertion can name the
 * row that would have been redeemable and by whom.
 *
 * Every "did not mint" assertion is paired with a control that mints, because
 * an empty recorder proves nothing about a gate if the seam never carried
 * anything in the first place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  createVerificationValue: vi.fn(async (_row: { identifier: string; value: string }) => ({
    id: 'v_1',
  })),
  createVerificationOTP: vi.fn(async () => '123456'),
  sendMagicLinkEmail: vi.fn(async () => undefined),
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
  getWorkspaceSettings: vi.fn(),
  userFindFirst: vi.fn(),
  invitationFindFirst: vi.fn(),
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
}))

vi.mock('../index', () => ({
  getAuth: vi.fn(async () => ({
    api: { createVerificationOTP: hoisted.createVerificationOTP },
    $context: { internalAdapter: { createVerificationValue: hoisted.createVerificationValue } },
  })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      settings: { findFirst: vi.fn(async () => null) },
      user: { findFirst: (...a: unknown[]) => hoisted.userFindFirst(...a) },
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
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.quackback.io' } }))

import { requestEmailSignin } from '../email-signin'

const STRANGER = 'stranger@evil.example'

/** Every address the recorder saw a redeemable row minted for. */
function mintedFor(): string[] {
  return hoisted.createVerificationValue.mock.calls.map(
    ([row]) => (JSON.parse(row.value) as { email: string }).email
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // The steady state: somebody owns this workspace, nobody can claim it by
  // arriving, and its admin has closed self-service sign-ups.
  hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: { openSignup: false } })
  hoisted.userFindFirst.mockResolvedValue(null)
  hoisted.invitationFindFirst.mockResolvedValue(null)
  hoisted.findHumanAdmin.mockResolvedValue({ id: 'principal_owner' })
  hoisted.isOpenToBootstrapClaim.mockResolvedValue(false)
})

describe('requestEmailSignin — openSignup, in front of the mint', () => {
  it('mints nothing and sends no sign-in link for a stranger', async () => {
    await requestEmailSignin({ email: STRANGER, callbackURL: '/' })

    expect(mintedFor()).toEqual([])
    expect(hoisted.createVerificationOTP).not.toHaveBeenCalled()
    expect(hoisted.sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  // It returns normally and reports nothing back, because the caller is an
  // unauthenticated endpoint and anything it could branch on is the oracle.
  // The reason goes to the address instead, in a message that grants nothing.
  it('tells the address, not the caller', async () => {
    await expect(requestEmailSignin({ email: STRANGER, callbackURL: '/' })).resolves.toBeUndefined()

    expect(hoisted.sendSignupNotAllowedEmail).toHaveBeenCalledTimes(1)
    const calls = hoisted.sendSignupNotAllowedEmail.mock.calls as unknown as Array<[{ to: string }]>
    expect(calls[0]![0].to).toBe(STRANGER)
  })

  // The control the assertion above depends on. Same recorder, same code path,
  // one fact flipped: if this does not record a row for the stranger, then
  // "minted nothing" above was a statement about the harness, not the gate.
  it('mints a redeemable row for that same stranger once sign-ups are open', async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: { openSignup: true } })

    await requestEmailSignin({ email: STRANGER, callbackURL: '/' })

    expect(mintedFor()).toEqual([STRANGER])
    expect(hoisted.sendMagicLinkEmail).toHaveBeenCalledTimes(1)
  })

  it('still mints for an account that already exists here', async () => {
    hoisted.userFindFirst.mockResolvedValue({ id: 'user_1' })

    await requestEmailSignin({ email: 'regular@acme.example', callbackURL: '/' })

    expect(mintedFor()).toEqual(['regular@acme.example'])
  })

  it('still mints for someone holding a pending invitation', async () => {
    hoisted.invitationFindFirst.mockResolvedValue({ id: 'invite_1' })

    await requestEmailSignin({ email: 'newhire@acme.example', callbackURL: '/' })

    expect(mintedFor()).toEqual(['newhire@acme.example'])
  })

  // The self-hosted first run, which reaches this path whenever the workspace
  // has password sign-in off.
  it('still mints for the first user of an unclaimed, unprovisioned install', async () => {
    hoisted.findHumanAdmin.mockResolvedValue(undefined)
    hoisted.isOpenToBootstrapClaim.mockResolvedValue(true)

    await requestEmailSignin({ email: 'first@acme.example', callbackURL: '/' })

    expect(mintedFor()).toEqual(['first@acme.example'])
  })

  // Same unclaimed workspace, provisioned instead of installed. This is the
  // shape a customer-provisioned workspace with no recorded owner has, and it
  // is the one an attacker enumerating hostnames is looking for.
  it('mints nothing on an unclaimed workspace a control plane provisioned', async () => {
    hoisted.findHumanAdmin.mockResolvedValue(undefined)
    hoisted.isOpenToBootstrapClaim.mockResolvedValue(false)

    await requestEmailSignin({ email: STRANGER, callbackURL: '/' })

    expect(mintedFor()).toEqual([])
    expect(hoisted.sendSignupNotAllowedEmail).toHaveBeenCalledTimes(1)
  })
})
