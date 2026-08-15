import { describe, expect, it } from 'vitest'
import { finiteUsageLines, formatUsageLine } from '../plan-usage'

describe('plan usage lines', () => {
  it('keeps only finite limits', () => {
    expect(
      finiteUsageLines([
        { key: 'maxBoards', label: 'boards', used: 1, limit: 3 },
        { key: 'maxPosts', label: 'posts', used: 4, limit: null },
      ])
    ).toEqual([{ key: 'maxBoards', label: 'boards', used: 1, limit: 3 }])
  })

  it('formats N of M', () => {
    expect(formatUsageLine({ key: 'maxBoards', label: 'boards', used: 1, limit: 3 })).toBe(
      '1 of 3 boards'
    )
  })
})
