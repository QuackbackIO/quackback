import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import { Route } from '../admin/inbox'

const options = (
  Route as unknown as {
    options: {
      loaderDeps?: unknown
      loader?: unknown
      validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>
    }
  }
).options

describe('inbox route shape', () => {
  it('has no loaderDeps so selection/filter changes never re-run the loader', () => {
    expect(options.loaderDeps).toBeUndefined()
    expect(typeof options.loader).toBe('function')
  })

  it('normalizes the legacy ?c= alias to ?i= for loader and component alike', () => {
    const id = generateId('conversation')
    expect(options.validateSearch?.({ c: id }).i).toBe(id)
  })
})
