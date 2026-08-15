import { describe, expect, it } from 'vitest'
import { Route } from '../feedback'

function parseFeedbackSearch(search: Record<string, unknown>) {
  const schema = Route.options.validateSearch as { parse: (input: unknown) => { sort?: string } }
  return schema.parse(search)
}

describe('admin feedback search', () => {
  it('does not fail the route when the portal leftover sort=trending is present', () => {
    expect(parseFeedbackSearch({ sort: 'trending' })).toEqual({ sort: 'newest' })
  })

  it('keeps a valid admin sort', () => {
    expect(parseFeedbackSearch({ sort: 'priority' }).sort).toBe('priority')
  })

  it('drops a portal board slug when the admin schema wants a string[]', () => {
    expect(parseFeedbackSearch({ board: 'product-feedback', sort: 'newest' })).toEqual({
      sort: 'newest',
    })
  })
})
