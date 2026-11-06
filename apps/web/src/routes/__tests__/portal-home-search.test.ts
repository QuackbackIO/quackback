/**
 * The portal home must not write a default sort into its URL. A schema default
 * makes the router redirect every bare "/" to "/?sort=trending" (a 307 that the
 * canonical link and the sitemap entry then point at). An absent sort already
 * means trending in the feed, so the default belongs there, not in the URL.
 */
import { describe, it, expect } from 'vitest'

const { Route } = await import('../_portal/index')

type SearchSchema =
  ((input: unknown) => Record<string, unknown>) | { parse: (i: unknown) => unknown }
const validate = (input: unknown) => {
  const schema = (Route as unknown as { options: { validateSearch: SearchSchema } }).options
    .validateSearch
  return typeof schema === 'function' ? schema(input) : schema.parse(input)
}

describe('portal home search', () => {
  it('leaves an absent sort out of the validated search, so "/" is not redirected', () => {
    expect(validate({})).toEqual({})
  })

  it('keeps a sort the visitor chose', () => {
    expect(validate({ sort: 'new' })).toEqual({ sort: 'new' })
  })
})
