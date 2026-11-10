/**
 * The emails a visitor gets while signing in name the workspace's brand, never
 * Quackback: the header logo's alt text and the subject lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@react-email/components'

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' })
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

import { sendPasswordResetEmail, sendSignupNotAllowedEmail } from '../index'
import { MagicLinkEmail } from '../templates/magic-link'
import { PasswordResetEmail } from '../templates/password-reset'
import { SignupNotAllowedEmail } from '../templates/signup-not-allowed'
import { VerifyAddressEmail } from '../templates/verify-address'

const LOGO = 'https://acme.test/brand.png?v=1&kind=icon'

describe('visitor emails name the brand', () => {
  it('give the header logo the workspace’s name', async () => {
    const htmls = await Promise.all([
      render(
        MagicLinkEmail({
          signInUrl: 'https://x/y',
          code: '123456',
          logoUrl: LOGO,
          workspaceName: 'Acme',
        })
      ),
      render(
        PasswordResetEmail({ resetLink: 'https://x/r', logoUrl: LOGO, workspaceName: 'Acme' })
      ),
      render(SignupNotAllowedEmail({ workspaceName: 'Acme', logoUrl: LOGO })),
      render(VerifyAddressEmail({ code: '123456', workspaceName: 'Acme', logoUrl: LOGO })),
    ])
    for (const html of htmls) {
      expect(html).toContain('alt="Acme"')
      expect(html).not.toContain('alt="Quackback"')
    }
  })

  describe('subjects', () => {
    const saved = { host: process.env.EMAIL_SMTP_HOST, from: process.env.EMAIL_FROM }
    beforeEach(() => {
      process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
      process.env.EMAIL_FROM = 'noreply@example.com'
      sendMailMock.mockClear()
    })
    afterEach(() => {
      process.env.EMAIL_SMTP_HOST = saved.host
      process.env.EMAIL_FROM = saved.from
      if (saved.host === undefined) delete process.env.EMAIL_SMTP_HOST
      if (saved.from === undefined) delete process.env.EMAIL_FROM
    })
    const subject = () => (sendMailMock.mock.calls.at(-1)![0] as { subject: string }).subject

    it('name the workspace, or nobody, never Quackback', async () => {
      await sendPasswordResetEmail({
        to: 'a@acme.test' as never,
        resetLink: 'https://x/r',
        workspaceName: 'Acme',
      })
      expect(subject()).toBe('Reset your Acme password')
      await sendPasswordResetEmail({ to: 'a@acme.test' as never, resetLink: 'https://x/r' })
      expect(subject()).toBe('Reset your password')
      await sendSignupNotAllowedEmail({ to: 'a@acme.test' as never, workspaceName: 'Acme' })
      expect(subject()).toBe('About your Acme sign-in request')
      await sendSignupNotAllowedEmail({ to: 'a@acme.test' as never })
      expect(subject()).toBe('About your sign-in request')
    })
  })
})
