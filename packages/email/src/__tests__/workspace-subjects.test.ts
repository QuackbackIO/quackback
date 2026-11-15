/**
 * Account mail to a workspace's own users names the workspace, not the product,
 * in the subject and the inbox preview. "Quackback" is only the fallback for an
 * install with no workspace name.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as email from '../index'
import type { ContactEmail } from '../recipient'
import { sealedTo } from './brands'

const resendSend = vi.hoisted(() => vi.fn())

vi.mock('resend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('resend')>()
  return {
    ...actual,
    Resend: class {
      emails = { send: resendSend }
    },
  }
})

const ENV_KEYS = [
  'EMAIL_SES_ACCESS_KEY_ID',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'EMAIL_SMTP_HOST',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_INBOUND_PROVIDER',
  'EMAIL_FROM',
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env.EMAIL_RESEND_API_KEY = 're_test'
  process.env.EMAIL_FROM = 'noreply@platform.test'
  resendSend.mockReset()
  resendSend.mockResolvedValue({ data: { id: 'resend-email-id' }, error: null, headers: null })
})
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] !== undefined) process.env[key] = saved[key]
    else delete process.env[key]
  }
})

const sent = () => resendSend.mock.calls.at(-1)?.[0] as { subject: string; html: string }

describe('password reset', () => {
  it('names the workspace in the subject and the preview', async () => {
    await email.sendPasswordResetEmail({
      to: sealedTo('person@example.test'),
      resetLink: 'https://acme.test/reset?token=t',
      workspaceName: 'Acme Widgets',
    })
    expect(sent().subject).toBe('Reset your Acme Widgets password')
    expect(sent().html).toContain('Reset your Acme Widgets password')
    expect(sent().html).not.toContain('Reset your Quackback password')
  })

  it('falls back to Quackback with no workspace name', async () => {
    await email.sendPasswordResetEmail({
      to: sealedTo('person@example.test'),
      resetLink: 'https://acme.test/reset?token=t',
    })
    expect(sent().subject).toBe('Reset your Quackback password')
  })
})

describe('sign-in refused', () => {
  it('names the workspace in the subject', async () => {
    await email.sendSignupNotAllowedEmail({
      to: 'person@example.test' as ContactEmail,
      workspaceName: 'Acme Widgets',
    })
    expect(sent().subject).toBe('About your Acme Widgets sign-in request')
  })

  it('falls back to Quackback with no workspace name', async () => {
    await email.sendSignupNotAllowedEmail({ to: 'person@example.test' as ContactEmail })
    expect(sent().subject).toBe('About your Quackback sign-in request')
  })
})
