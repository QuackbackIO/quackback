/**
 * A look is answered under a strict schema, which the provider compiles into a
 * grammar. Past a size it refuses the request outright ("The compiled grammar is
 * too large"), and every start falls back to an unbranded portal. Nested objects
 * cost the most: the schema compiled at 60 properties and was refused at 72, when
 * the page words were four nested objects. Hold it there, and flatten a new field
 * or ask for it in a second call rather than grow the look.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { directionsSchema } from '../design-looks'

const properties = (node: unknown): number =>
  !node || typeof node !== 'object'
    ? 0
    : Object.entries(node).reduce(
        (n, [key, value]) =>
          n + (key === 'properties' ? Object.keys(value as object).length : 0) + properties(value),
        0
      )

describe('the looks’ answer schema', () => {
  it('stays within the grammar the provider compiles', () => {
    expect(properties(z.toJSONSchema(directionsSchema))).toBeLessThanOrEqual(64)
  })
})
