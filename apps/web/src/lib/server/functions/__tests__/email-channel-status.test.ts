/**
 * The Transport card's read: whether this server offers custom sending domains.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const requireAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth }))

const { getEmailChannelStatusFn } = await import('../settings')
const getStatus = getEmailChannelStatusFn as unknown as AnyHandler

const SES_ENV: Record<string, string> = {
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
  vi.unstubAllEnvs()
  requireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'admin' } })
})

describe('getEmailChannelStatusFn customDomains', () => {
  it('is available with SES and the identity credential', async () => {
    stubEnv(SES_ENV)
    expect(await getStatus()).toMatchObject({ provider: 'ses', customDomains: 'available' })
  })

  it('is unavailable without the identity credential', async () => {
    stubEnv({ ...SES_ENV, EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY: '' })
    expect(await getStatus()).toMatchObject({ provider: 'ses', customDomains: 'unavailable' })
  })

  it('is unavailable with a non-SES provider', async () => {
    stubEnv({
      EMAIL_SMTP_HOST: 'smtp.example.com',
      EMAIL_SES_REGION: 'eu-west-2',
      EMAIL_SES_IDENTITY_ACCESS_KEY_ID: 'AKIAIDENT',
      EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY: 'ident-secret',
    })
    expect(await getStatus()).toMatchObject({ provider: 'smtp', customDomains: 'unavailable' })
  })
})
