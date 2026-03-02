import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CommentId, PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'

// --- Mock: capture handlers registered via createServerFn ---

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

// --- Mock: comment service ---

const mockCanEditComment = vi.fn()
const mockCanDeleteComment = vi.fn()
const mockCanPinComment = vi.fn()

vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  canEditComment: (...args: unknown[]) => mockCanEditComment(...args),
  canDeleteComment: (...args: unknown[]) => mockCanDeleteComment(...args),
  canPinComment: (...args: unknown[]) => mockCanPinComment(...args),
  addReaction: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  pinComment: vi.fn(),
  removeReaction: vi.fn(),
  softDeleteComment: vi.fn(),
  unpinComment: vi.fn(),
  updateComment: vi.fn(),
  userEditComment: vi.fn(),
}))

// --- Mock: auth helpers ---

const mockGetOptionalAuth = vi.fn()
const mockHasSessionCookie = vi.fn()

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: () => mockGetOptionalAuth(),
  requireAuth: vi.fn(),
  hasSessionCookie: () => mockHasSessionCookie(),
}))

// --- Handler setup ---

// Handler indices match the declaration order in comments.ts:
// 0: createCommentFn, 1: updateCommentFn, 2: deleteCommentFn,
// 3: addReactionFn, 4: removeReactionFn, 5: getCommentPermissionsFn,
// 6: userEditCommentFn, 7: userDeleteCommentFn, 8: pinCommentFn,
// 9: unpinCommentFn, 10: canPinCommentFn
const HANDLER_INDEX_GET_COMMENT_PERMISSIONS = 5
const HANDLER_INDEX_CAN_PIN_COMMENT = 10

let getCommentPermissionsHandler: AnyHandler
let canPinCommentHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../comments')
  }
  getCommentPermissionsHandler = handlersByIndex[HANDLER_INDEX_GET_COMMENT_PERMISSIONS]
  canPinCommentHandler = handlersByIndex[HANDLER_INDEX_CAN_PIN_COMMENT]
})

// --- Shared fixtures ---

const COMMENT_ID = 'comment_test123' as unknown as CommentId
const MOCK_AUTH_CONTEXT = {
  principal: {
    id: 'principal_test123' as PrincipalId,
    role: 'admin' as const,
  },
  user: { id: 'user_test123', email: 'test@test.com', name: 'Test', image: null },
  settings: { id: 'ws_test', slug: 'test', name: 'Test Workspace' },
}

// ============================================
// getCommentPermissionsFn
// ============================================

describe('getCommentPermissionsFn error handling', () => {
  it('should catch NotFoundError and return no-permission defaults', async () => {
    mockHasSessionCookie.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanEditComment.mockRejectedValue(
      new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found')
    )

    const result = await getCommentPermissionsHandler({ data: { commentId: COMMENT_ID } })

    expect(result).toEqual({ canEdit: false, canDelete: false })
  })

  it('should re-throw non-NotFoundError errors', async () => {
    mockHasSessionCookie.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanEditComment.mockRejectedValue(new Error('Database connection lost'))

    await expect(getCommentPermissionsHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      'Database connection lost'
    )
  })

  it('should re-throw TypeError (not a NotFoundError)', async () => {
    mockHasSessionCookie.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanEditComment.mockRejectedValue(new TypeError('Cannot read properties of undefined'))

    await expect(getCommentPermissionsHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      TypeError
    )
  })
})

// ============================================
// canPinCommentFn
// ============================================

describe('canPinCommentFn error handling', () => {
  it('should catch NotFoundError and return canPin=false with reason', async () => {
    mockHasSessionCookie.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanPinComment.mockRejectedValue(new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found'))

    const result = await canPinCommentHandler({ data: { commentId: COMMENT_ID } })

    expect(result).toEqual({ canPin: false, reason: 'Comment not found' })
  })

  it('should re-throw non-NotFoundError errors', async () => {
    mockHasSessionCookie.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanPinComment.mockRejectedValue(new Error('Database connection lost'))

    await expect(canPinCommentHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      'Database connection lost'
    )
  })

  it('should re-throw TypeError (not a NotFoundError)', async () => {
    mockHasSessionCookie.mockReturnValue(true)
    mockGetOptionalAuth.mockResolvedValue(MOCK_AUTH_CONTEXT)
    mockCanPinComment.mockRejectedValue(new TypeError('Cannot read properties of undefined'))

    await expect(canPinCommentHandler({ data: { commentId: COMMENT_ID } })).rejects.toThrow(
      TypeError
    )
  })
})
