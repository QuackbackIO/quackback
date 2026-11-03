/**
 * The sending-domain server functions: the capability gate and the message a
 * failed action carries back to the settings page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SesIdentityError } from '@quackback/email/ses-identity'

type AnyHandler = (args?: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  defaultTeamId: vi.fn(),
  provision: vi.fn(),
  refresh: vi.fn(),
  restart: vi.fn(),
  deleteDomain: vi.fn(),
  listSendingDomains: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))

vi.mock(
  '@/lib/server/domains/channel-accounts/channel-account.service',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/lib/server/domains/channel-accounts/channel-account.service')
    >()),
    defaultTeamId: hoisted.defaultTeamId,
    deleteSendingDomain: hoisted.deleteDomain,
    listSendingDomains: hoisted.listSendingDomains,
  })
)

vi.mock('@/lib/server/domains/channel-accounts/sending-identity', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/channel-accounts/sending-identity')
  >()),
  provisionSendingDomain: hoisted.provision,
  refreshSendingDomain: hoisted.refresh,
  restartSendingDomainChecks: hoisted.restart,
}))

const {
  createSendingDomainFn,
  verifySendingDomainFn,
  deleteSendingDomainFn,
  restartSendingDomainChecksFn,
} = await import('../channel-accounts')
const restartChecks = restartSendingDomainChecksFn as unknown as AnyHandler
const createDomain = createSendingDomainFn as unknown as AnyHandler
const verifyDomain = verifySendingDomainFn as unknown as AnyHandler
const deleteDomain = deleteSendingDomainFn as unknown as AnyHandler

const SES_ENV = {
  EMAIL_SES_ACCESS_KEY_ID: 'AKIASEND',
  EMAIL_SES_SECRET_ACCESS_KEY: 'send-secret',
  EMAIL_SES_REGION: 'eu-west-2',
  EMAIL_SES_IDENTITY_ACCESS_KEY_ID: 'AKIAIDENT',
  EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY: 'ident-secret',
}

function stubEnv(env: Record<string, string>) {
  for (const key of [
    ...Object.keys(SES_ENV),
    'EMAIL_SMTP_HOST',
    'EMAIL_RESEND_API_KEY',
    'RESEND_API_KEY',
  ]) {
    vi.stubEnv(key, env[key] ?? '')
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'admin' } })
  hoisted.defaultTeamId.mockResolvedValue('team_1')
})

describe('createSendingDomainFn', () => {
  it('refuses on a server without the identity credential, before any database work', async () => {
    stubEnv({ ...SES_ENV, EMAIL_SES_IDENTITY_ACCESS_KEY_ID: '' })
    await expect(createDomain({ data: { domain: 'acme.com' } })).rejects.toThrow(
      "Custom sending addresses aren't available on this server."
    )
    expect(hoisted.provision).not.toHaveBeenCalled()
    expect(hoisted.defaultTeamId).not.toHaveBeenCalled()
  })

  it('refuses when another provider sends the mail', async () => {
    stubEnv({
      EMAIL_SMTP_HOST: 'smtp.example.com',
      EMAIL_SES_REGION: 'eu-west-2',
      EMAIL_SES_IDENTITY_ACCESS_KEY_ID: 'AKIAIDENT',
      EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY: 'ident-secret',
    })
    await expect(createDomain({ data: { domain: 'acme.com' } })).rejects.toThrow(
      "Custom sending addresses aren't available on this server."
    )
    expect(hoisted.provision).not.toHaveBeenCalled()
  })

  it('provisions when available', async () => {
    stubEnv(SES_ENV)
    hoisted.provision.mockResolvedValue({
      id: 'sending_domain_1',
      domain: 'acme.com',
      status: 'pending',
      dnsRecords: [],
      verifiedAt: null,
      mailFromLabel: 'qb-bounce',
      autoCheckUntil: null,
      preflight: {},
      lastCheckedAt: null,
    })
    await createDomain({ data: { domain: 'acme.com' } })
    expect(hoisted.provision).toHaveBeenCalledWith({ owningTeamId: 'team_1', domain: 'acme.com' })
  })

  it('carries a provider denial back as a setup message', async () => {
    stubEnv(SES_ENV)
    hoisted.provision.mockRejectedValue(
      new SesIdentityError('SES refused', 400, 'AccessDeniedException', false)
    )
    await expect(createDomain({ data: { domain: 'acme.com' } })).rejects.toThrow(
      "Custom sending domains aren't set up correctly on this server. Nothing was added."
    )
  })
})

describe('verifySendingDomainFn and deleteSendingDomainFn', () => {
  it('asks for a retry on a transient provider failure', async () => {
    stubEnv(SES_ENV)
    hoisted.refresh.mockRejectedValue(new SesIdentityError('throttled', 429, 'Throttling', true))
    await expect(verifyDomain({ data: { id: 'sending_domain_1' } })).rejects.toThrow(
      "Couldn't reach the mail provider. Try again in a minute."
    )
  })

  it('falls back to the remove wording for an unknown failure', async () => {
    hoisted.deleteDomain.mockRejectedValue(new Error('connection reset'))
    await expect(deleteDomain({ data: { id: 'sending_domain_1' } })).rejects.toThrow(
      "Couldn't remove the domain. Try again, and if it keeps failing, contact your workspace's operator."
    )
  })
})

describe('restartSendingDomainChecksFn', () => {
  it('restarts the named domain and returns its window', async () => {
    hoisted.restart.mockResolvedValue({
      id: 'sending_domain_1',
      domain: 'acme.com',
      status: 'pending',
      dnsRecords: [],
      verifiedAt: null,
      mailFromLabel: 'qb-bounce',
      autoCheckUntil: new Date('2026-11-06T10:00:00.000Z'),
      preflight: {},
      lastCheckedAt: new Date('2026-11-03T10:00:00.000Z'),
    })
    const result = await restartChecks({ data: { id: 'sending_domain_1' } })
    expect(hoisted.restart).toHaveBeenCalledWith('sending_domain_1')
    expect(result).toMatchObject({
      autoCheckUntil: '2026-11-06T10:00:00.000Z',
      lastCheckedAt: '2026-11-03T10:00:00.000Z',
      mailFromLabel: 'qb-bounce',
    })
  })

  it('says so when the domain is gone', async () => {
    hoisted.restart.mockResolvedValue(null)
    await expect(restartChecks({ data: { id: 'sending_domain_1' } })).rejects.toThrow(
      'That sending domain no longer exists.'
    )
  })
})
