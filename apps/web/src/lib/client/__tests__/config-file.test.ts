import { describe, it, expect } from 'vitest'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '../config-file'

describe('isPathManagedFromBootstrap', () => {
  it('returns false when the bootstrap data has no managed paths', () => {
    expect(isPathManagedFromBootstrap('workspace.name', [])).toBe(false)
  })

  it('matches an exact path', () => {
    expect(isPathManagedFromBootstrap(MANAGED_PATHS.WORKSPACE_NAME, ['workspace.name'])).toBe(true)
  })

  it('matches a child of a whole-block managed path', () => {
    expect(isPathManagedFromBootstrap('tierLimits.maxBoards', ['tierLimits'])).toBe(true)
  })
})

describe('MANAGED_PATHS', () => {
  it('exports a stable set of canonical paths', () => {
    expect(MANAGED_PATHS.WORKSPACE_NAME).toBe('workspace.name')
    expect(MANAGED_PATHS.WORKSPACE_SLUG).toBe('workspace.slug')
    expect(MANAGED_PATHS.WORKSPACE_USE_CASE).toBe('workspace.useCase')
    expect(MANAGED_PATHS.TIER_LIMITS).toBe('tierLimits')
  })
})
