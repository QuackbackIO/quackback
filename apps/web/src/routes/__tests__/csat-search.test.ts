/**
 * The /csat page opens from the face links in the close and rating-request
 * emails: `/csat?token=…&rating=4`. The router parses each search value as
 * JSON first, so `rating=4` reaches the route as the number 4. The page must
 * open for every link it can be sent, preselect a valid face, and degrade
 * anything else to "nothing preselected" rather than an error page.
 */
import { describe, expect, it } from 'vitest'
import { defaultParseSearch } from '@tanstack/react-router'

const { Route } = await import('../csat')

type SearchSchema =
  ((input: unknown) => Record<string, unknown>) | { parse: (i: unknown) => unknown }

/** The search the route sees for a URL query, through the router's own parser. */
function searchFor(query: string) {
  const raw = defaultParseSearch(query)
  const schema = (Route as unknown as { options: { validateSearch: SearchSchema } }).options
    .validateSearch
  return typeof schema === 'function' ? schema(raw) : schema.parse(raw)
}

describe('/csat search', () => {
  it('opens an emailed face link with that face', () => {
    expect(searchFor('?token=abc.def&rating=4')).toEqual({ token: 'abc.def', rating: 4 })
  })

  it.each([1, 2, 3, 4, 5])('accepts face %i', (face) => {
    expect(searchFor(`?token=t&rating=${face}`)).toEqual({ token: 't', rating: face })
  })

  it.each(['9', '0', '-1', '2.5', 'abc', 'true', 'null', '%5B1%5D', ''])(
    'opens with nothing preselected for rating=%s',
    (rating) => {
      expect(searchFor(`?token=t&rating=${rating}`)).toEqual({ token: 't', rating: undefined })
    }
  )

  it('opens a link that carries no rating', () => {
    expect(searchFor('?token=t')).toEqual({ token: 't', rating: undefined })
  })

  it('keeps a token the parser read as a number', () => {
    expect(searchFor('?token=123&rating=2')).toEqual({ token: '123', rating: 2 })
  })

  it('treats a token that is not text as missing', () => {
    expect(searchFor('?token=true')).toEqual({ token: undefined, rating: undefined })
  })
})
