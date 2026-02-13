import { describe, it, expect, vi } from 'vitest'

// Mock the email package before importing the handler
vi.mock('@quackback/email', () => ({
  sendStatusChangeEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}))

import { emailHook } from '../handlers/email'
import { sendStatusChangeEmail, sendNewCommentEmail } from '@quackback/email'
import type { EmailTarget, EmailConfig } from '../hook-types'

const mockStatusChangeEmail = vi.mocked(sendStatusChangeEmail)
const mockNewCommentEmail = vi.mocked(sendNewCommentEmail)

const baseEvent = {
  id: 'evt-test',
  timestamp: new Date().toISOString(),
  actor: { id: 'user_test', type: 'user' as const, name: 'Test User' },
  data: {},
}

const baseTarget: EmailTarget = {
  email: 'user@example.com',
  unsubscribeUrl: 'https://example.com/unsubscribe',
}

const baseConfig: EmailConfig = {
  workspaceName: 'TestWorkspace',
  postUrl: 'https://example.com/post/1',
  postTitle: 'Test Post',
}

describe('emailHook', () => {
  describe('when email is configured (sent: true)', () => {
    it('sends status change email and returns success', async () => {
      mockStatusChangeEmail.mockResolvedValue({ sent: true })

      const result = await emailHook.run(
        { ...baseEvent, type: 'post.status_changed' },
        baseTarget,
        { ...baseConfig, previousStatus: 'open', newStatus: 'in_progress' }
      )

      expect(result).toEqual({ success: true })
      expect(mockStatusChangeEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        postTitle: 'Test Post',
        postUrl: 'https://example.com/post/1',
        previousStatus: 'open',
        newStatus: 'in_progress',
        workspaceName: 'TestWorkspace',
        unsubscribeUrl: 'https://example.com/unsubscribe',
      })
    })

    it('sends new comment email and returns success', async () => {
      mockNewCommentEmail.mockResolvedValue({ sent: true })

      const result = await emailHook.run({ ...baseEvent, type: 'comment.created' }, baseTarget, {
        ...baseConfig,
        commenterName: 'Commenter',
        commentPreview: 'Hello',
        isTeamMember: true,
      })

      expect(result).toEqual({ success: true })
      expect(mockNewCommentEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        postTitle: 'Test Post',
        postUrl: 'https://example.com/post/1',
        commenterName: 'Commenter',
        commentPreview: 'Hello',
        isTeamMember: true,
        workspaceName: 'TestWorkspace',
        unsubscribeUrl: 'https://example.com/unsubscribe',
      })
    })
  })

  describe('when email is not configured (sent: false)', () => {
    it('returns success without error for status change', async () => {
      mockStatusChangeEmail.mockResolvedValue({ sent: false })

      const result = await emailHook.run(
        { ...baseEvent, type: 'post.status_changed' },
        baseTarget,
        { ...baseConfig, previousStatus: 'open', newStatus: 'closed' }
      )

      expect(result).toEqual({ success: true })
      expect(result.shouldRetry).toBeUndefined()
    })

    it('returns success without error for new comment', async () => {
      mockNewCommentEmail.mockResolvedValue({ sent: false })

      const result = await emailHook.run({ ...baseEvent, type: 'comment.created' }, baseTarget, {
        ...baseConfig,
        commenterName: 'Commenter',
        commentPreview: 'Hi',
      })

      expect(result).toEqual({ success: true })
      expect(result.shouldRetry).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('returns failure with shouldRetry for network errors', async () => {
      const error = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      mockStatusChangeEmail.mockRejectedValue(error)

      const result = await emailHook.run(
        { ...baseEvent, type: 'post.status_changed' },
        baseTarget,
        { ...baseConfig, previousStatus: 'open', newStatus: 'closed' }
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection refused')
      expect(result.shouldRetry).toBe(true)
    })

    it('returns failure without retry for non-retryable errors', async () => {
      mockNewCommentEmail.mockRejectedValue(new Error('Invalid template'))

      const result = await emailHook.run({ ...baseEvent, type: 'comment.created' }, baseTarget, {
        ...baseConfig,
        commenterName: 'X',
        commentPreview: 'Y',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid template')
      expect(result.shouldRetry).toBe(false)
    })
  })

  it('returns failure for unsupported event types', async () => {
    const result = await emailHook.run(
      { ...baseEvent, type: 'post.created' },
      baseTarget,
      baseConfig
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported event type')
  })
})
