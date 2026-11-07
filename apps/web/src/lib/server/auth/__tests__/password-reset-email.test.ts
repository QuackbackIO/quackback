import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  send: vi.fn(async (_params: Record<string, unknown>) => ({ sent: true })),
  configured: true,
  recipient: 'owner@example.test' as string | null,
  settings: { name: 'Acme Widgets', logoKey: null } as null | {
    name: string
    logoKey: string | null
  },
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => hoisted.configured,
  sendPasswordResetEmail: hoisted.send,
}))
vi.mock('@/lib/server/email/recipient', () => ({
  resolveAccountRecipient: vi.fn(async () => hoisted.recipient),
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: vi.fn(async () => hoisted.settings) } } },
}))
vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))

import { sendPasswordResetLink } from '../password-reset-email'

describe('sendPasswordResetLink', () => {
  beforeEach(() => {
    hoisted.send.mockClear()
    hoisted.configured = true
    hoisted.recipient = 'owner@example.test'
    hoisted.settings = { name: 'Acme Widgets', logoKey: null }
  })

  it('names the workspace on the reset email, so the platform From carries it', async () => {
    await sendPasswordResetLink({ id: 'user_1' }, 'https://acme.test/reset?t=1')
    expect(hoisted.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.test',
        resetLink: 'https://acme.test/reset?t=1',
        workspaceName: 'Acme Widgets',
      })
    )
  })

  it('never passes a From: account mail stays on the platform address', async () => {
    await sendPasswordResetLink({ id: 'user_1' }, 'https://acme.test/reset?t=1')
    expect(hoisted.send.mock.calls[0][0]).not.toHaveProperty('from')
  })

  it('still sends with no settings row to name the workspace', async () => {
    hoisted.settings = null
    await sendPasswordResetLink({ id: 'user_1' }, 'https://acme.test/reset?t=1')
    expect(hoisted.send).toHaveBeenCalledWith(expect.objectContaining({ workspaceName: undefined }))
  })

  it('sends nothing when the account has no deliverable address', async () => {
    hoisted.recipient = null
    await sendPasswordResetLink({ id: 'user_1' }, 'https://acme.test/reset?t=1')
    expect(hoisted.send).not.toHaveBeenCalled()
  })

  it('sends nothing when email is not configured', async () => {
    hoisted.configured = false
    await sendPasswordResetLink({ id: 'user_1' }, 'https://acme.test/reset?t=1')
    expect(hoisted.send).not.toHaveBeenCalled()
  })
})
