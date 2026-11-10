/**
 * The designer's frame keeps saying so as the portal navigates within it: a
 * route that rewrites its own search keeps `designer` and `visitor`, so the
 * next page the frame loads is still the designer's, and still signed out.
 */
import { describe, it, expect } from 'vitest'

const { Route } = await import('../_portal')

const options = (
  Route as unknown as {
    options: {
      validateSearch: (input: unknown) => Record<string, unknown>
      search: { middlewares: unknown[] }
    }
  }
).options

describe('portal search in the designer frame', () => {
  it('reads the frame and its visitor, and nothing else for them', () => {
    // The router reads `designer=1` as a number, and writes it back as one.
    expect(options.validateSearch({ designer: 1, visitor: 'out' })).toMatchObject({
      designer: 1,
      visitor: 'out',
    })
    expect(options.validateSearch({ designer: '1' })).toMatchObject({ designer: 1 })
    const other = options.validateSearch({ designer: 'yes', visitor: 'in' })
    expect(other.designer).toBeUndefined()
    expect(other.visitor).toBeUndefined()
  })

  it('keeps both as the frame navigates', () => {
    const retain = options.search.middlewares[0] as (input: {
      search: Record<string, unknown>
      next: (search: Record<string, unknown>) => unknown
    }) => Record<string, unknown>
    const kept = retain({
      search: { designer: 1, visitor: 'out', theme: 'dark' },
      next: () => ({ search: { roadmap: 'roadmap_1' }, meta: {} }),
    })
    expect(kept).toMatchObject({ roadmap: 'roadmap_1', designer: 1, visitor: 'out' })
  })
})
