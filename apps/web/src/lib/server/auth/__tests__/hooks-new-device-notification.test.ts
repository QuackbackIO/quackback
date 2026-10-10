/**
 * `handleNewDeviceNotification` — runs after `handleSignInSuccessAudit`
 * in the hooksAfter chain. Identity is the signed device cookie.
 *   1. Resolve / mint a cookie id, write it on every real sign-in.
 *   2. `isDeviceUnseen` atomically claims the id.
 *      Returns true iff this is an additional unseen device.
 *   3. On true: send email + emit `auth.signin.new_device` audit.
 *      On failure: call `forgetDevice` to roll back the claim so the
 *      next sign-in re-fires the notification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthConfig, makeWorkspace } from './_helpers'

vi.mock('@/lib/server/config', () => ({
  config: { trustedProxyHops: 1 },
  getBaseUrl: () => 'https://acme.example',
}))

vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'unit-test-device-cookie-secret',
}))

const MINTED_DEVICE_ID = 'ab'.repeat(16)

vi.mock('../signin-device-cookie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../signin-device-cookie')>()
  return {
    ...actual,
    mintDeviceId: () => MINTED_DEVICE_ID,
  }
})

const mockIsDeviceUnseen = vi.fn()
const mockForgetDevice = vi.fn(async (_userId: string, _deviceId: string) => undefined)
const mockSendNewSignInEmail = vi.fn(async (_params: unknown) => ({ sent: true }))
const mockRecordAuditEvent = vi.fn(async (_spec: unknown) => undefined)

vi.mock('../signin-device-tracker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../signin-device-tracker')>()
  return {
    ...actual,
    isDeviceUnseen: (userId: string, deviceId: string) => mockIsDeviceUnseen(userId, deviceId),
    forgetDevice: (userId: string, deviceId: string) => mockForgetDevice(userId, deviceId),
  }
})

vi.mock('@quackback/email', () => ({
  sendNewSignInEmail: (params: unknown) => mockSendNewSignInEmail(params),
}))

const mockListIdentityProviders = vi.fn()
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: () => mockListIdentityProviders(),
}))

const mockGetRegisteredOidcProviderIds = vi.fn()
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: (providers?: unknown) =>
    mockGetRegisteredOidcProviderIds(providers),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (spec: unknown) => mockRecordAuditEvent(spec),
}))

// The alert is account-class, so the recipient is looked up by id rather than
// read off the session — the session's address would be the synthetic
// placeholder for anyone whose provider releases no email.
vi.mock('@/lib/server/db', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: { query: { user: { findFirst: vi.fn(async () => ({ email: 'a@b.com' })) } } },
  }
})

const defaultHeaders = () =>
  new Headers({
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'x-forwarded-for': '203.0.113.42',
  })

const mockGetRequestHeaders = vi.fn(defaultHeaders)

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => mockGetRequestHeaders(),
}))

const { handleNewDeviceNotification } = await import('../hooks')
const { deviceCookieAttributes, deviceCookieName, signDeviceCookie } =
  await import('../signin-device-cookie')

type Ctx = Parameters<typeof handleNewDeviceNotification>[0]
type Workspace = Parameters<typeof handleNewDeviceNotification>[1]

const mockSetCookie = vi.fn()

const buildCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
  path: '/sign-in/email',
  context: {
    newSession: {
      user: { id: 'user_abc', email: 'a@b.com' },
      session: { token: 'tok' },
    },
  },
  setCookie: mockSetCookie,
  ...overrides,
})

const workspace = () =>
  makeWorkspace({
    name: 'Acme',
    authConfig: makeAuthConfig(),
  }) as Workspace

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRequestHeaders.mockImplementation(defaultHeaders)
  // Restore default impls — `clearAllMocks` clears history but `*Once`
  // implementations queued by prior tests can still influence the
  // first call. Explicit reset keeps each test independent.
  mockIsDeviceUnseen.mockReset().mockResolvedValue(false)
  mockForgetDevice.mockReset().mockResolvedValue(undefined)
  mockSendNewSignInEmail.mockReset().mockResolvedValue({ sent: true })
  mockRecordAuditEvent.mockReset().mockResolvedValue(undefined)
  mockListIdentityProviders.mockReset().mockResolvedValue([])
  mockGetRegisteredOidcProviderIds.mockReset().mockResolvedValue(new Set())
  mockSetCookie.mockReset()
})

function expectDeviceCookieWritten(deviceId: string = MINTED_DEVICE_ID) {
  expect(mockSetCookie).toHaveBeenCalledWith(
    deviceCookieName('user_abc'),
    signDeviceCookie('user_abc', deviceId),
    deviceCookieAttributes(true)
  )
}

describe('handleNewDeviceNotification — happy path', () => {
  it('sends email + audits on an additional unseen device', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    await handleNewDeviceNotification(buildCtx(), workspace())

    expect(mockIsDeviceUnseen).toHaveBeenCalledWith('user_abc', MINTED_DEVICE_ID)
    expectDeviceCookieWritten()

    expect(mockSendNewSignInEmail).toHaveBeenCalledTimes(1)
    const emailArgs = mockSendNewSignInEmail.mock.calls[0][0] as {
      to: string
      workspaceName: string
      ipAddress: string
      userAgent: string
      settingsUrl?: string
      location?: string | null
      ssoEnforced?: boolean
    }
    expect(emailArgs.to).toBe('a@b.com')
    expect(emailArgs.workspaceName).toBe('Acme')
    expect(emailArgs.ipAddress).toBe('203.0.113.42')
    expect(emailArgs.userAgent).toBe('Chrome on Windows')
    expect(emailArgs.settingsUrl).toBe('https://acme.example/settings/profile')
    expect(emailArgs.ssoEnforced).toBe(false)

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const auditArgs = mockRecordAuditEvent.mock.calls[0][0] as { event: string }
    expect(auditArgs.event).toBe('auth.signin.new_device')

    expect(mockForgetDevice).not.toHaveBeenCalled()
  })

  it('passes ssoEnforced: true when the recipient is SSO-bound', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    mockListIdentityProviders.mockResolvedValueOnce([
      {
        id: 'idp_sso',
        registrationId: 'sso',
        showButton: false,
        domains: [{ name: 'b.com', verifiedAt: '2026-05-01T00:00:00.000Z', enforced: true }],
      },
    ])
    mockGetRegisteredOidcProviderIds.mockResolvedValueOnce(new Set(['sso']))

    await handleNewDeviceNotification(buildCtx(), workspace())

    expect(mockSendNewSignInEmail).toHaveBeenCalledTimes(1)
    const emailArgs = mockSendNewSignInEmail.mock.calls[0][0] as {
      ssoEnforced?: boolean
      settingsUrl?: string
    }
    expect(emailArgs.ssoEnforced).toBe(true)
    expect(emailArgs.settingsUrl).toBeUndefined()
  })

  it('still sends the alert when the SSO lookup throws', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    mockListIdentityProviders.mockRejectedValueOnce(new Error('idp down'))

    await expect(handleNewDeviceNotification(buildCtx(), workspace())).resolves.toBeUndefined()

    expect(mockSendNewSignInEmail).toHaveBeenCalledTimes(1)
    const emailArgs = mockSendNewSignInEmail.mock.calls[0][0] as { ssoEnforced?: boolean }
    expect(emailArgs.ssoEnforced).toBe(false)
    expect(mockForgetDevice).not.toHaveBeenCalled()
  })

  it('still writes the cookie when the device is already known', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(false)
    await handleNewDeviceNotification(buildCtx(), workspace())

    expectDeviceCookieWritten()
    expect(mockIsDeviceUnseen).toHaveBeenCalledWith('user_abc', MINTED_DEVICE_ID)
    expect(mockSendNewSignInEmail).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
    expect(mockForgetDevice).not.toHaveBeenCalled()
  })

  it('reuses a valid cookie id instead of minting', async () => {
    const knownId = 'cd'.repeat(16)
    const headers = defaultHeaders()
    headers.set(
      'cookie',
      `${deviceCookieName('user_abc')}=${signDeviceCookie('user_abc', knownId)}`
    )
    mockGetRequestHeaders.mockReturnValueOnce(headers)
    mockIsDeviceUnseen.mockResolvedValueOnce(false)

    await handleNewDeviceNotification(buildCtx(), workspace())

    expect(mockIsDeviceUnseen).toHaveBeenCalledWith('user_abc', knownId)
    expectDeviceCookieWritten(knownId)
  })

  it("ignores another user's cookie on a shared browser", async () => {
    const otherId = 'ee'.repeat(16)
    const headers = defaultHeaders()
    headers.set(
      'cookie',
      `${deviceCookieName('user_other')}=${signDeviceCookie('user_other', otherId)}`
    )
    mockGetRequestHeaders.mockReturnValueOnce(headers)
    mockIsDeviceUnseen.mockResolvedValueOnce(true)

    await handleNewDeviceNotification(buildCtx(), workspace())

    expect(mockIsDeviceUnseen).toHaveBeenCalledWith('user_abc', MINTED_DEVICE_ID)
    expectDeviceCookieWritten()
  })
})

describe('handleNewDeviceNotification — guards', () => {
  it('bails when newSession is missing (sign-in was revoked upstream)', async () => {
    const ctx = buildCtx({ context: { newSession: null } })
    await handleNewDeviceNotification(ctx, workspace())
    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
    expect(mockSetCookie).not.toHaveBeenCalled()
  })

  it('bails when user.email is missing (can’t notify without an address)', async () => {
    const ctx = buildCtx({
      context: { newSession: { user: { id: 'user_x' }, session: { token: 'tok' } } },
    })
    await handleNewDeviceNotification(ctx, workspace())
    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
  })

  it('does not treat a session-cookie refresh as a sign-in', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    await handleNewDeviceNotification(buildCtx({ path: '/get-session' }), workspace())
    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
    expect(mockSendNewSignInEmail).not.toHaveBeenCalled()
    expect(mockSetCookie).not.toHaveBeenCalled()
  })

  it('does not notify on an anonymous widget mint', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    await handleNewDeviceNotification(buildCtx({ path: '/sign-in/anonymous' }), workspace())
    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
    expect(mockSendNewSignInEmail).not.toHaveBeenCalled()
  })

  it('does not claim a minted id when setCookie is missing', async () => {
    const ctx = buildCtx()
    delete ctx.setCookie
    await handleNewDeviceNotification(ctx, workspace())
    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
    expect(mockSendNewSignInEmail).not.toHaveBeenCalled()
  })

  it('still claims when an existing cookie cannot be refreshed', async () => {
    const knownId = 'cd'.repeat(16)
    const headers = defaultHeaders()
    headers.set(
      'cookie',
      `${deviceCookieName('user_abc')}=${signDeviceCookie('user_abc', knownId)}`
    )
    mockGetRequestHeaders.mockReturnValueOnce(headers)
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    const ctx = buildCtx()
    delete ctx.setCookie

    await handleNewDeviceNotification(ctx, workspace())

    expect(mockIsDeviceUnseen).toHaveBeenCalledWith('user_abc', knownId)
    expect(mockSendNewSignInEmail).toHaveBeenCalled()
  })
})

describe('handleNewDeviceNotification — failure tolerance', () => {
  it('rolls back via forgetDevice when sendNewSignInEmail throws', async () => {
    // This is the critical regression test for the original bug:
    // SMTP outage must NOT permanently mark the device as seen.
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    mockSendNewSignInEmail.mockRejectedValueOnce(new Error('smtp down'))

    await expect(handleNewDeviceNotification(buildCtx(), workspace())).resolves.toBeUndefined()

    expect(mockForgetDevice).toHaveBeenCalledWith('user_abc', MINTED_DEVICE_ID)
  })

  it('rolls back via forgetDevice when recordAuditEvent throws', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    mockRecordAuditEvent.mockRejectedValueOnce(new Error('audit store down'))

    await expect(handleNewDeviceNotification(buildCtx(), workspace())).resolves.toBeUndefined()

    expect(mockForgetDevice).toHaveBeenCalledWith('user_abc', MINTED_DEVICE_ID)
  })
})

describe('handleNewDeviceNotification — account with no deliverable address', () => {
  it('sends no alert, but still audits and marks the device seen', async () => {
    // Someone whose provider releases no email carries a placeholder. The alert
    // discloses IP, user agent and sign-in timing, so it must not fall back to
    // a contact address an agent may have typed. The claim must stay (no
    // forgetDevice), or every later sign-in retries a send that can never work.
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.user.findFirst).mockResolvedValueOnce({
      email: 'sso-oidc-abc-deadbeef@anon.quackback.io',
    } as never)

    await handleNewDeviceNotification(buildCtx(), workspace())

    expect(mockSendNewSignInEmail).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).toHaveBeenCalled()
    expect(mockForgetDevice).not.toHaveBeenCalled()
  })
})
