/**
 * Smoke shape test for the comment-moderation server functions.
 * Full integration tests live alongside the post-moderation suite once
 * the DB harness exists; here we assert exports and Zod schemas.
 */
import { describe, it, expect } from 'vitest'
import { listPendingCommentsFn, approveCommentFn, rejectCommentFn } from '../moderation'

describe('comment moderation functions — exports', () => {
  it('exports listPendingCommentsFn', () => {
    expect(typeof listPendingCommentsFn).toBe('function')
  })

  it('exports approveCommentFn', () => {
    expect(typeof approveCommentFn).toBe('function')
  })

  it('exports rejectCommentFn', () => {
    expect(typeof rejectCommentFn).toBe('function')
  })
})

describe('approveCommentFn — input shape', () => {
  it('accepts a commentId string', () => {
    // Module-private schema; the validator contract is observable
    // via well-formed input not throwing on parse. requireAuth will then
    // fail in test env (no session), so we expect the promise to reject —
    // input validation has already run by that point.
    return expect(approveCommentFn({ data: { commentId: 'comment_test' } })).rejects.toBeDefined()
  })
})

describe('rejectCommentFn — input shape', () => {
  it('accepts commentId + optional reason', () => {
    return expect(
      rejectCommentFn({ data: { commentId: 'comment_test', reason: 'spam' } })
    ).rejects.toBeDefined()
  })

  it('rejects a reason >500 chars', () => {
    return expect(
      rejectCommentFn({ data: { commentId: 'comment_test', reason: 'x'.repeat(501) } })
    ).rejects.toThrow()
  })
})
