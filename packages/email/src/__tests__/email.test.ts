import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isEmailConfigured,
  sendInvitationEmail,
  sendWelcomeEmail,
  sendSigninCodeEmail,
  sendStatusChangeEmail,
  sendNewCommentEmail,
} from '../index'

/** Save and restore env vars around each test. */
function withCleanEnv() {
  const saved: Record<string, string | undefined> = {}
  const keys = [
    'EMAIL_SMTP_HOST',
    'EMAIL_SMTP_PORT',
    'EMAIL_SMTP_USER',
    'EMAIL_SMTP_PASS',
    'EMAIL_RESEND_API_KEY',
    'RESEND_API_KEY',
    'EMAIL_FROM',
  ]

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key]
      } else {
        delete process.env[key]
      }
    }
  })
}

describe('isEmailConfigured', () => {
  withCleanEnv()

  it('returns false when no email env vars are set', () => {
    expect(isEmailConfigured()).toBe(false)
  })

  it('returns true when SMTP host is set', () => {
    process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
    expect(isEmailConfigured()).toBe(true)
  })

  it('returns true when Resend API key is set', () => {
    process.env.EMAIL_RESEND_API_KEY = 're_test_123'
    expect(isEmailConfigured()).toBe(true)
  })

  it('returns true when RESEND_API_KEY (alternate) is set', () => {
    process.env.RESEND_API_KEY = 're_test_123'
    expect(isEmailConfigured()).toBe(true)
  })

  it('prefers SMTP over Resend when both are set', () => {
    process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
    process.env.EMAIL_RESEND_API_KEY = 're_test_123'
    expect(isEmailConfigured()).toBe(true)
  })
})

describe('console mode returns { sent: false }', () => {
  withCleanEnv()

  it('sendInvitationEmail returns { sent: false }', async () => {
    const result = await sendInvitationEmail({
      to: 'test@example.com',
      invitedByName: 'Admin',
      workspaceName: 'TestWorkspace',
      inviteLink: 'https://example.com/invite',
    })
    expect(result).toEqual({ sent: false })
  })

  it('sendWelcomeEmail returns { sent: false }', async () => {
    const result = await sendWelcomeEmail({
      to: 'test@example.com',
      name: 'Test',
      workspaceName: 'TestWorkspace',
      dashboardUrl: 'https://example.com/dashboard',
    })
    expect(result).toEqual({ sent: false })
  })

  it('sendSigninCodeEmail returns { sent: false }', async () => {
    const result = await sendSigninCodeEmail({
      to: 'test@example.com',
      code: '123456',
    })
    expect(result).toEqual({ sent: false })
  })

  it('sendStatusChangeEmail returns { sent: false }', async () => {
    const result = await sendStatusChangeEmail({
      to: 'test@example.com',
      postTitle: 'Test Post',
      postUrl: 'https://example.com/post/1',
      previousStatus: 'open',
      newStatus: 'in_progress',
      workspaceName: 'TestWorkspace',
      unsubscribeUrl: 'https://example.com/unsubscribe',
    })
    expect(result).toEqual({ sent: false })
  })

  it('sendNewCommentEmail returns { sent: false }', async () => {
    const result = await sendNewCommentEmail({
      to: 'test@example.com',
      postTitle: 'Test Post',
      postUrl: 'https://example.com/post/1',
      commenterName: 'Commenter',
      commentPreview: 'This is a comment',
      isTeamMember: false,
      workspaceName: 'TestWorkspace',
      unsubscribeUrl: 'https://example.com/unsubscribe',
    })
    expect(result).toEqual({ sent: false })
  })
})
