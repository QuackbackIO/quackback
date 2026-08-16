import { describe, expect, it } from 'vitest'
import { Route } from '../feedback'

function parseFeedbackSearch(search: Record<string, unknown>) {
  const validate = Route.options.validateSearch as (input: Record<string, unknown>) => {
    sort?: string
    board?: string[]
  }
  return validate(search)
}

describe('admin feedback search', () => {
  it('does not fail the route when the portal leftover sort=trending is present', () => {
    expect(parseFeedbackSearch({ sort: 'trending' })).toEqual({ sort: 'newest' })
  })

  it('keeps a valid admin sort', () => {
    expect(parseFeedbackSearch({ sort: 'priority' }).sort).toBe('priority')
  })

  it('drops a portal board slug when the admin schema wants a string[]', () => {
    const parsed = parseFeedbackSearch({ board: 'product-feedback', sort: 'newest' })
    expect(parsed.sort).toBe('newest')
    expect(parsed.board).toBeUndefined()
    expect({ ...{ board: 'product-feedback', sort: 'newest' }, ...parsed }).toEqual({
      board: undefined,
      sort: 'newest',
    })
  })
})
