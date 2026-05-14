/**
 * `handleNewDeviceNotification` — runs after `handleSignInSuccessAudit`
 * in the hooksAfter chain. Uses the two-phase tracker API:
 *   1. `isDeviceUnseen` atomically claims the fingerprint via SADD.
 *      Returns true iff this is the first sighting (SADD reply = 1).
 *   2. On true: send email + emit `auth.signin.new_device` audit.
 *      On success: call `markDeviceSeen` to refresh the 90-day TTL.
 *      On failure: call `forgetDevice` to roll back the claim so the
 *      next sign-in re-fires the notification.
 *
 * Workspace-configurable via `authConfig.security.notifyOnNewSignIn`
 * (default `true`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthConfig, makeTenant } from './_helpers'

const mockIsDeviceUnseen = vi.fn()
const mockMarkDeviceSeen = vi.fn(async (_userId: string) => undefined)
const mockForgetDevice = vi.fn(async (_userId: string, _fp: string) => undefined)
const mockSendNewSignInEmail = vi.fn(async (_params: unknown) => ({ sent: true }))
const mockRecordAuditEvent = vi.fn(async (_spec: unknown) => undefined)

vi.mock('../signin-device-tracker', () => ({
  computeDeviceFingerprint: (ua: string, ip: string) => `fp-${ua}-${ip}`,
  isDeviceUnseen: (userId: string, fp: string) => mockIsDeviceUnseen(userId, fp),
  markDeviceSeen: (userId: string) => mockMarkDeviceSeen(userId),
  forgetDevice: (userId: string, fp: string) => mockForgetDevice(userId, fp),
}))

vi.mock('@quackback/email', () => ({
  sendNewSignInEmail: (params: unknown) => mockSendNewSignInEmail(params),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (spec: unknown) => mockRecordAuditEvent(spec),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () =>
    new Headers({ 'user-agent': 'Mozilla/5.0 Test', 'x-forwarded-for': '203.0.113.42' }),
}))

const { handleNewDeviceNotification } = await import('../hooks')

type Ctx = Parameters<typeof handleNewDeviceNotification>[0]
type Tenant = Parameters<typeof handleNewDeviceNotification>[1]

const buildCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
  path: '/sign-in/email',
  context: {
    newSession: {
      user: { id: 'user_abc', email: 'a@b.com' },
      session: { token: 'tok' },
    },
  },
  ...overrides,
})

const tenantWith = (notify: boolean | undefined) =>
  makeTenant({
    name: 'Acme',
    authConfig: makeAuthConfig({ security: { notifyOnNewSignIn: notify } }),
  }) as Tenant

beforeEach(() => {
  vi.clearAllMocks()
  // Restore default impls — `clearAllMocks` clears history but `*Once`
  // implementations queued by prior tests can still influence the
  // first call. Explicit reset keeps each test independent.
  mockIsDeviceUnseen.mockReset().mockResolvedValue(false)
  mockMarkDeviceSeen.mockReset().mockResolvedValue(undefined)
  mockForgetDevice.mockReset().mockResolvedValue(undefined)
  mockSendNewSignInEmail.mockReset().mockResolvedValue({ sent: true })
  mockRecordAuditEvent.mockReset().mockResolvedValue(undefined)
})

describe('handleNewDeviceNotification — happy path', () => {
  it('sends email + audits + markDeviceSeen on first-seen device', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    await handleNewDeviceNotification(buildCtx(), tenantWith(true))

    expect(mockSendNewSignInEmail).toHaveBeenCalledTimes(1)
    const emailArgs = mockSendNewSignInEmail.mock.calls[0][0] as {
      to: string
      workspaceName: string
      ipAddress: string
      userAgent: string
    }
    expect(emailArgs.to).toBe('a@b.com')
    expect(emailArgs.workspaceName).toBe('Acme')
    expect(emailArgs.ipAddress).toBe('203.0.113.42')
    expect(emailArgs.userAgent).toBe('Mozilla/5.0 Test')

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const auditArgs = mockRecordAuditEvent.mock.calls[0][0] as { event: string }
    expect(auditArgs.event).toBe('auth.signin.new_device')

    // TTL refreshed only on the success path.
    expect(mockMarkDeviceSeen).toHaveBeenCalledWith('user_abc')
    expect(mockForgetDevice).not.toHaveBeenCalled()
  })

  it('no-ops when the device is already known', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(false)
    await handleNewDeviceNotification(buildCtx(), tenantWith(true))

    expect(mockSendNewSignInEmail).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
    expect(mockMarkDeviceSeen).not.toHaveBeenCalled()
    expect(mockForgetDevice).not.toHaveBeenCalled()
  })

  it('default-true: missing toggle still notifies', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    await handleNewDeviceNotification(buildCtx(), tenantWith(undefined))
    expect(mockSendNewSignInEmail).toHaveBeenCalled()
  })

  it('respects workspace opt-out (notifyOnNewSignIn=false)', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    await handleNewDeviceNotification(buildCtx(), tenantWith(false))

    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
    expect(mockSendNewSignInEmail).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
    expect(mockMarkDeviceSeen).not.toHaveBeenCalled()
  })
})

describe('handleNewDeviceNotification — guards', () => {
  it('bails when newSession is missing (sign-in was revoked upstream)', async () => {
    const ctx = buildCtx({ context: { newSession: null } })
    await handleNewDeviceNotification(ctx, tenantWith(true))
    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
  })

  it('bails when user.email is missing (can’t notify without an address)', async () => {
    const ctx = buildCtx({
      context: { newSession: { user: { id: 'user_x' }, session: { token: 'tok' } } },
    })
    await handleNewDeviceNotification(ctx, tenantWith(true))
    expect(mockIsDeviceUnseen).not.toHaveBeenCalled()
  })
})

describe('handleNewDeviceNotification — failure tolerance', () => {
  it('swallows isDeviceUnseen errors (Redis outage should not block sign-in)', async () => {
    mockIsDeviceUnseen.mockRejectedValueOnce(new Error('redis down'))
    await expect(handleNewDeviceNotification(buildCtx(), tenantWith(true))).resolves.toBeUndefined()
    // Tracker errored before claiming → no rollback needed.
    expect(mockForgetDevice).not.toHaveBeenCalled()
  })

  it('rolls back via forgetDevice when sendNewSignInEmail throws', async () => {
    // This is the critical regression test for the original bug:
    // SMTP outage must NOT permanently mark the device as seen.
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    mockSendNewSignInEmail.mockRejectedValueOnce(new Error('smtp down'))

    await expect(handleNewDeviceNotification(buildCtx(), tenantWith(true))).resolves.toBeUndefined()

    expect(mockForgetDevice).toHaveBeenCalledWith('user_abc', expect.stringMatching(/^fp-/))
    expect(mockMarkDeviceSeen).not.toHaveBeenCalled()
  })

  it('rolls back via forgetDevice when recordAuditEvent throws', async () => {
    mockIsDeviceUnseen.mockResolvedValueOnce(true)
    mockRecordAuditEvent.mockRejectedValueOnce(new Error('audit store down'))

    await expect(handleNewDeviceNotification(buildCtx(), tenantWith(true))).resolves.toBeUndefined()

    expect(mockForgetDevice).toHaveBeenCalled()
    expect(mockMarkDeviceSeen).not.toHaveBeenCalled()
  })
})
