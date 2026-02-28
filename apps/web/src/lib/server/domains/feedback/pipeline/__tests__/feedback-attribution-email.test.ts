/**
 * Tests for feedback attribution email helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, PostId } from '@quackback/ids'

const mockPrincipalFindFirst = vi.fn()
const mockUserFindFirst = vi.fn()
const mockPostFindFirst = vi.fn()
const mockSettingsFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
      user: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      posts: { findFirst: (...args: unknown[]) => mockPostFindFirst(...args) },
      settings: { findFirst: (...args: unknown[]) => mockSettingsFindFirst(...args) },
    },
  },
  eq: vi.fn(),
  principal: { id: 'id' },
  user: { id: 'id' },
  posts: { id: 'id' },
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: vi.fn(() => 'https://example.com'),
}))

const mockGenerateUnsubscribeToken = vi.fn().mockResolvedValue('unsub-token-123')

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  generateUnsubscribeToken: (...args: unknown[]) => mockGenerateUnsubscribeToken(...args),
}))

const mockSendEmail = vi.fn().mockResolvedValue({ sent: true })

vi.mock('@quackback/email', () => ({
  sendFeedbackLinkedEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

describe('sendFeedbackAttributionEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const principalId = 'principal_ext' as PrincipalId
  const postId = 'post_123' as PostId
  const resolvedByPrincipalId = 'principal_admin' as PrincipalId

  it('should send email with correct params', async () => {
    mockPrincipalFindFirst
      .mockResolvedValueOnce({ userId: 'user_1' }) // recipient principal
      .mockResolvedValueOnce({ userId: 'user_admin' }) // resolver principal
    mockUserFindFirst
      .mockResolvedValueOnce({ email: 'customer@example.com', name: 'Jane Doe' }) // recipient
      .mockResolvedValueOnce({ name: 'Admin Alice' }) // resolver
    mockPostFindFirst.mockResolvedValueOnce({
      title: 'Export to CSV',
      boardId: 'board_1',
      board: { slug: 'features' },
    })
    mockSettingsFindFirst.mockResolvedValueOnce({ name: 'Acme Corp' })

    const { sendFeedbackAttributionEmail } = await import('../feedback-attribution-email')
    await sendFeedbackAttributionEmail(principalId, postId, resolvedByPrincipalId)

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        recipientName: 'Jane Doe',
        postTitle: 'Export to CSV',
        postUrl: 'https://example.com/b/features/posts/post_123',
        workspaceName: 'Acme Corp',
        unsubscribeUrl: 'https://example.com/unsubscribe?token=unsub-token-123',
        attributedByName: 'Admin Alice',
      })
    )
  })

  it('should skip synthetic emails', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ userId: 'user_1' })
    mockUserFindFirst.mockResolvedValueOnce({
      email: 'intercom+abc123@external.quackback.io',
      name: null,
    })

    const { sendFeedbackAttributionEmail } = await import('../feedback-attribution-email')
    await sendFeedbackAttributionEmail(principalId, postId)

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('should skip when no email found', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ userId: null })

    const { sendFeedbackAttributionEmail } = await import('../feedback-attribution-email')
    await sendFeedbackAttributionEmail(principalId, postId)

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('should skip when post not found', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ userId: 'user_1' })
    mockUserFindFirst.mockResolvedValueOnce({ email: 'test@example.com', name: 'Test' })
    mockPostFindFirst.mockResolvedValueOnce(null)

    const { sendFeedbackAttributionEmail } = await import('../feedback-attribution-email')
    await sendFeedbackAttributionEmail(principalId, postId)

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('should not throw when email sending fails', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ userId: 'user_1' })
    mockUserFindFirst.mockResolvedValueOnce({ email: 'test@example.com', name: 'Test' })
    mockPostFindFirst.mockResolvedValueOnce({
      title: 'Test Post',
      boardId: 'b1',
      board: { slug: 'general' },
    })
    mockSettingsFindFirst.mockResolvedValueOnce({ name: 'Test Workspace' })
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP failed'))

    const { sendFeedbackAttributionEmail } = await import('../feedback-attribution-email')
    // Should not throw
    await expect(sendFeedbackAttributionEmail(principalId, postId)).resolves.toBeUndefined()
  })
})
