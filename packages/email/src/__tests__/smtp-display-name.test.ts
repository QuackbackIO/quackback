/**
 * Over SMTP the display name goes to the mail library as a name, not as a
 * pre-encoded string: the library encodes it itself, and an encoded word it
 * receives inside a string ends up quoted, which mail clients then show raw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' })
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

import { sendPasswordResetEmail } from '../index'
import { sealedTo } from './brands'

const saved: Record<string, string | undefined> = {}
const KEYS = ['EMAIL_SMTP_HOST', 'EMAIL_SES_ACCESS_KEY_ID', 'EMAIL_RESEND_API_KEY', 'EMAIL_FROM']
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
  process.env.EMAIL_FROM = 'noreply@example.com'
  sendMailMock.mockClear()
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] !== undefined) process.env[k] = saved[k]
    else delete process.env[k]
  }
})

const sentFrom = () => (sendMailMock.mock.calls[0][0] as { from: unknown }).from

describe('the From over SMTP', () => {
  it('hands a non-Latin workspace name over unencoded', async () => {
    await sendPasswordResetEmail({
      to: sealedTo('sam@acme.test'),
      resetLink: 'https://acme.test/reset?token=t',
      workspaceName: 'ร้านกาแฟ',
    })
    expect(sentFrom()).toEqual({ name: 'ร้านกาแฟ', address: 'noreply@example.com' })
  })

  it('hands a name with a comma over as one name', async () => {
    await sendPasswordResetEmail({
      to: sealedTo('sam@acme.test'),
      resetLink: 'https://acme.test/reset?token=t',
      workspaceName: 'Acme, Inc',
    })
    expect(sentFrom()).toEqual({ name: 'Acme, Inc', address: 'noreply@example.com' })
  })

  it('hands an agent name on a workspace address over unencoded', async () => {
    const { plainAddress, applyDisplayName } = await import('../ses')
    expect(plainAddress(applyDisplayName('help@acme.test', 'Søren from Acme'))).toEqual({
      name: 'Søren from Acme',
      address: 'help@acme.test',
    })
    expect(plainAddress(applyDisplayName('help@acme.test', 'Acme, "Support"'))).toEqual({
      name: 'Acme, "Support"',
      address: 'help@acme.test',
    })
  })

  it('sends a From with no name to give it as written', async () => {
    await sendPasswordResetEmail({
      to: sealedTo('sam@acme.test'),
      resetLink: 'https://acme.test/reset?token=t',
    })
    expect(sentFrom()).toBe('noreply@example.com')
  })
})
