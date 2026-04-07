import { describe, it, expect } from 'vitest'
import { addReplyToTree, replaceOptimisticInTree } from '../comment-tree-helpers'
import type { CommentId } from '@quackback/ids'

interface TestComment {
  id: string
  parentId: string | null
  content: string
  createdAt?: string | Date
  replies: TestComment[]
}

function makeComment(id: string, parentId: string | null = null, content = 'test'): TestComment {
  return { id, parentId, content, replies: [] }
}

describe('addReplyToTree', () => {
  it('adds reply to top-level comment', () => {
    const comments = [makeComment('c1'), makeComment('c2')]
    const reply = makeComment('c3', 'c1', 'reply')
    const result = addReplyToTree(comments, 'c1', reply)

    expect(result[0].replies).toHaveLength(1)
    expect(result[0].replies[0].content).toBe('reply')
    expect(result[1].replies).toHaveLength(0)
  })

  it('adds reply to nested comment', () => {
    const nested = { ...makeComment('c2', 'c1'), replies: [] }
    const comments: TestComment[] = [{ ...makeComment('c1'), replies: [nested] }]
    const reply = makeComment('c3', 'c2', 'deep reply')
    const result = addReplyToTree(comments, 'c2', reply)

    expect(result[0].replies[0].replies).toHaveLength(1)
    expect(result[0].replies[0].replies[0].content).toBe('deep reply')
  })

  it('does not mutate original array', () => {
    const comments = [makeComment('c1')]
    const reply = makeComment('c2', 'c1')
    const result = addReplyToTree(comments, 'c1', reply)

    expect(comments[0].replies).toHaveLength(0)
    expect(result[0].replies).toHaveLength(1)
  })

  it('returns comments unchanged if parentId not found', () => {
    const comments = [makeComment('c1')]
    const reply = makeComment('c2', 'nonexistent')
    const result = addReplyToTree(comments, 'nonexistent', reply)

    expect(result[0].replies).toHaveLength(0)
  })
})

describe('replaceOptimisticInTree', () => {
  it('replaces optimistic comment at top level', () => {
    const comments: TestComment[] = [
      { id: 'comment_temp123', parentId: null, content: 'hello', replies: [] },
    ]
    const result = replaceOptimisticInTree(comments, 'comment_temp', null, 'hello', {
      id: 'comment_real456' as CommentId,
      createdAt: new Date('2025-01-01'),
    })

    expect(result[0].id).toBe('comment_real456')
  })

  it('replaces optimistic comment in nested replies', () => {
    const comments: TestComment[] = [
      {
        id: 'c1',
        parentId: null,
        content: 'parent',
        replies: [{ id: 'comment_optimistic_99', parentId: 'c1', content: 'child', replies: [] }],
      },
    ]
    const result = replaceOptimisticInTree(comments, 'comment_optimistic_', 'c1', 'child', {
      id: 'comment_real789' as CommentId,
      createdAt: '2025-01-01T00:00:00.000Z',
    })

    expect(result[0].replies[0].id).toBe('comment_real789')
  })

  it('does not replace non-matching content', () => {
    const comments: TestComment[] = [
      { id: 'comment_temp1', parentId: null, content: 'hello', replies: [] },
    ]
    const result = replaceOptimisticInTree(comments, 'comment_temp', null, 'different content', {
      id: 'comment_real' as CommentId,
      createdAt: new Date(),
    })

    expect(result[0].id).toBe('comment_temp1')
  })

  it('does not replace non-matching parentId', () => {
    const comments: TestComment[] = [
      { id: 'comment_temp1', parentId: 'p1', content: 'hello', replies: [] },
    ]
    const result = replaceOptimisticInTree(comments, 'comment_temp', 'p2', 'hello', {
      id: 'comment_real' as CommentId,
      createdAt: new Date(),
    })

    expect(result[0].id).toBe('comment_temp1')
  })

  it('handles string createdAt pass-through', () => {
    const comments: TestComment[] = [
      { id: 'comment_temp1', parentId: null, content: 'test', replies: [] },
    ]
    const result = replaceOptimisticInTree(comments, 'comment_temp', null, 'test', {
      id: 'comment_real' as CommentId,
      createdAt: '2025-06-15T12:00:00.000Z',
    })

    expect(result[0].createdAt).toBe('2025-06-15T12:00:00.000Z')
  })

  it('converts Date createdAt to ISO string', () => {
    const comments: TestComment[] = [
      { id: 'comment_temp1', parentId: null, content: 'test', replies: [] },
    ]
    const result = replaceOptimisticInTree(comments, 'comment_temp', null, 'test', {
      id: 'comment_real' as CommentId,
      createdAt: new Date('2025-06-15T12:00:00.000Z'),
    })

    expect(result[0].createdAt).toBe('2025-06-15T12:00:00.000Z')
  })
})
