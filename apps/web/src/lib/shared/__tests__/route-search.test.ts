import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { blankOmittedSearchKeys } from '../route-search'

const searchSchema = z.object({
  board: z.array(z.string()).optional().catch(undefined),
  minVotes: z.string().optional().catch(undefined),
  sort: z
    .enum(['newest', 'oldest', 'votes', 'priority'])
    .optional()
    .catch('newest')
    .default('newest'),
})

function parse(raw: Record<string, unknown>) {
  return blankOmittedSearchKeys(raw, searchSchema.parse(raw))
}

/** TanStack's match merge: parent leftovers win unless validated sets them. */
function mergeLikeRouter(raw: Record<string, unknown>) {
  return { ...raw, ...parse(raw) }
}

describe('blankOmittedSearchKeys', () => {
  it('remaps a leftover portal sort so the router merge cannot keep trending', () => {
    expect(mergeLikeRouter({ sort: 'trending' })).toEqual({ sort: 'newest' })
  })

  it('blanks a portal board slug so the merge cannot resurrect a string', () => {
    expect(mergeLikeRouter({ board: 'product-feedback', sort: 'newest' })).toEqual({
      board: undefined,
      sort: 'newest',
    })
  })

  it('blanks portal-only keys the admin schema does not declare', () => {
    expect(mergeLikeRouter({ sort: 'trending', tagIds: ['tag_1'], minVotes: 3 })).toEqual({
      sort: 'newest',
      tagIds: undefined,
      minVotes: undefined,
    })
  })

  it('keeps a valid admin sort', () => {
    expect(parse({ sort: 'priority' }).sort).toBe('priority')
  })
})
