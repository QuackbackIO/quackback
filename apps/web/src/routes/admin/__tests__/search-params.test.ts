import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}))
vi.mock('@/components/admin/ask/search-results-page', () => ({ SearchResultsPage: () => null }))

const { Route } = await import('../search')

type Search = { q: string; kind?: string; page?: number }
const validate = (
  Route as unknown as { options: { validateSearch: (raw: Record<string, unknown>) => Search } }
).options.validateSearch

describe('admin search params', () => {
  it('keeps a valid kind and page', () => {
    expect(validate({ q: 'a b', kind: 'post', page: '2' })).toMatchObject({ kind: 'post', page: 2 })
  })

  it.each([{ kind: 'nope' }, { page: '99' }, { page: 'abc' }, { page: '0' }, { page: '1.5' }])(
    'returns an invalid value %j as an explicit undefined so the raw value cannot survive',
    (raw) => {
      const result = validate({ q: 'invoice', ...raw })
      for (const key of Object.keys(raw)) {
        expect(Object.keys(result)).toContain(key)
        expect(result[key as 'kind' | 'page']).toBeUndefined()
      }
    }
  )
})
