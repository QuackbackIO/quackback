/**
 * The emails that answer a request (password reset, address check) pass the
 * browser language of that request to the reader's language order, after the
 * person's own choice. The order itself is tested in email-locale.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  acceptLanguage: 'fr-FR,fr;q=0.9' as string | null,
  recipientEmailLocale: vi.fn(
    async (_reader: unknown, opts: { acceptLanguage?: string | null }) => ({
      lang: opts.acceptLanguage ?? 'en',
      dir: 'ltr' as const,
      t: () => '',
    })
  ),
  sendPasswordResetEmail: vi.fn(async (_params: Record<string, unknown>) => ({ sent: true })),
  sendVerifyAddressEmail: vi.fn(async (_params: Record<string, unknown>) => ({ sent: true })),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () =>
    new Headers(hoisted.acceptLanguage ? { 'accept-language': hoisted.acceptLanguage } : {}),
}))
vi.mock('@/lib/server/email/email-locale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/email/email-locale')>()),
  recipientEmailLocale: hoisted.recipientEmailLocale,
}))
vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendPasswordResetEmail: hoisted.sendPasswordResetEmail,
  sendVerifyAddressEmail: hoisted.sendVerifyAddressEmail,
}))
vi.mock('@/lib/server/email/recipient', () => ({
  resolveAccountRecipient: vi.fn(async () => 'sam@example.com'),
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: vi.fn(async () => ({ name: 'Acme', logoKey: null })) } } },
}))
vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/auth/request-session', () => ({ getRequestSession: async () => null }))

import { sendPasswordResetLink } from '../password-reset-email'
import { sendVerifyAddressCode } from '../verify-address-email'

describe("request emails and the request's browser language", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.acceptLanguage = 'fr-FR,fr;q=0.9'
  })

  it("passes the reset request's browser language", async () => {
    await sendPasswordResetLink({ id: 'user_1' }, 'https://acme.test/reset?t=1')
    expect(hoisted.recipientEmailLocale).toHaveBeenCalledWith(
      { userId: 'user_1' },
      { acceptLanguage: 'fr-FR,fr;q=0.9' }
    )
    expect(hoisted.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ i18n: expect.objectContaining({ lang: 'fr-FR,fr;q=0.9' }) })
    )
  })

  it("passes the address check request's browser language", async () => {
    await sendVerifyAddressCode('sam@example.com', '123456')
    expect(hoisted.recipientEmailLocale).toHaveBeenCalledWith(
      { email: 'sam@example.com' },
      { acceptLanguage: 'fr-FR,fr;q=0.9' }
    )
  })

  it('passes no browser language when the request sent none', async () => {
    hoisted.acceptLanguage = null
    await sendPasswordResetLink({ id: 'user_1' }, 'https://acme.test/reset?t=1')
    expect(hoisted.recipientEmailLocale).toHaveBeenCalledWith(
      { userId: 'user_1' },
      { acceptLanguage: null }
    )
  })
})
