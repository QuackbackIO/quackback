import { describe, it, expect } from 'vitest'
import { countLiveComments } from '../widget-post-detail'

describe('countLiveComments', () => {
  it('returns 0 for empty array', () => {
    expect(countLiveComments([])).toBe(0)
  })

  it('counts non-deleted comments', () => {
    const comments = [
      { deletedAt: null, replies: [] },
      { deletedAt: null, replies: [] },
      { deletedAt: null, replies: [] },
    ]
    expect(countLiveComments(comments)).toBe(3)
  })

  it('excludes deleted comments', () => {
    const comments = [
      { deletedAt: null, replies: [] },
      { deletedAt: '2024-01-01', replies: [] },
      { deletedAt: null, replies: [] },
    ]
    expect(countLiveComments(comments)).toBe(2)
  })

  it('counts nested replies recursively', () => {
    const comments = [
      {
        deletedAt: null,
        replies: [
          { deletedAt: null, replies: [] },
          { deletedAt: null, replies: [{ deletedAt: null, replies: [] }] },
        ],
      },
    ]
    expect(countLiveComments(comments)).toBe(4) // 1 root + 2 replies + 1 nested
  })

  it('excludes deleted replies from count', () => {
    const comments = [
      {
        deletedAt: null,
        replies: [
          { deletedAt: null, replies: [] },
          { deletedAt: new Date(), replies: [] },
        ],
      },
    ]
    expect(countLiveComments(comments)).toBe(2) // 1 root + 1 live reply
  })

  it('handles deleted parent with live replies', () => {
    const comments = [
      {
        deletedAt: '2024-01-01',
        replies: [{ deletedAt: null, replies: [] }],
      },
    ]
    expect(countLiveComments(comments)).toBe(1) // only the reply
  })

  it('handles deeply nested structure', () => {
    const comments = [
      {
        deletedAt: null,
        replies: [
          {
            deletedAt: null,
            replies: [
              {
                deletedAt: null,
                replies: [{ deletedAt: null, replies: [] }],
              },
            ],
          },
        ],
      },
    ]
    expect(countLiveComments(comments)).toBe(4)
  })
})
