import { describe, it, expect } from 'vitest'
import { computeManagedPaths, isPathManaged } from '../managed-paths'

describe('computeManagedPaths', () => {
  it('returns [] for an empty spec', () => {
    expect(computeManagedPaths({})).toEqual([])
  })

  it('emits leaf paths for workspace.* fields', () => {
    expect(
      computeManagedPaths({
        workspace: { name: 'X', slug: 'x', useCase: 'saas' },
      })
    ).toEqual(['workspace.name', 'workspace.slug', 'workspace.useCase'])
  })

  it('omits workspace leaves that are absent', () => {
    expect(computeManagedPaths({ workspace: { name: 'X' } })).toEqual(['workspace.name'])
  })

  it('emits the whole-block path "tierLimits" for any tierLimits presence', () => {
    expect(computeManagedPaths({ tierLimits: { maxBoards: 5 } })).toEqual(['tierLimits'])
  })

  it('emits per-key feature paths', () => {
    expect(
      computeManagedPaths({ features: { helpCenter: true, experimentalRichEditor: false } })
    ).toEqual(['features.helpCenter', 'features.experimentalRichEditor'])
  })

  it('combines all path types into one stable-ordered list', () => {
    expect(
      computeManagedPaths({
        workspace: { name: 'X' },
        tierLimits: {},
        features: { a: true },
      })
    ).toEqual(['workspace.name', 'tierLimits', 'features.a'])
  })

  it('emits per-key auth.oauth paths and the auth.openSignup leaf', () => {
    expect(
      computeManagedPaths({
        auth: { oauth: { google: true, github: false }, openSignup: false },
      })
    ).toEqual(['auth.oauth.google', 'auth.oauth.github', 'auth.openSignup'])
  })

  it('omits auth.openSignup when only oauth providers are declared', () => {
    expect(computeManagedPaths({ auth: { oauth: { google: true } } })).toEqual([
      'auth.oauth.google',
    ])
  })
})

describe('isPathManaged', () => {
  it('matches an exact path', () => {
    expect(isPathManaged('workspace.name', ['workspace.name'])).toBe(true)
  })

  it('matches a child of a whole-block managed path', () => {
    expect(isPathManaged('tierLimits.maxBoards', ['tierLimits'])).toBe(true)
  })

  it('does not match a different leaf under the same parent', () => {
    expect(isPathManaged('features.a', ['features.b'])).toBe(false)
  })

  it('does not match an unrelated path', () => {
    expect(isPathManaged('portalConfig.oauth.google.enabled', ['workspace.name'])).toBe(false)
  })

  it('returns false for an empty managed list', () => {
    expect(isPathManaged('workspace.name', [])).toBe(false)
  })
})
