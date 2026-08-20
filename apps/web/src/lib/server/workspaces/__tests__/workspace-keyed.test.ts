/**
 * `WorkspaceKeyedCache` itself.
 *
 * It had no direct tests, and that is exactly how `workspaceKeys()` shipped dead:
 * `compose()` and `clearWorkspace()` composed with a NUL separator while
 * `workspaceKeys()` composed with a space, so it matched nothing and always
 * returned `[]`. The failure mode is silent (memory, not behaviour) — and
 * the test written to cover it asserted a negative that held either way.
 *
 * The separator now lives in one place, but a shared constant is a convention
 * and this file is the check. Every method that composes a key is exercised
 * against every other, so the three can never again hold two opinions.
 */
import { describe, it, expect } from 'vitest'
import {
  WorkspaceKeyedCache,
  workspaceScopedKey,
  currentWorkspaceNamespace,
} from '../workspace-keyed'
import { withWorkspace } from '@/lib/server/__tests__/workspace-scope'

describe('the methods that compose a key agree with each other', () => {
  it('workspaceKeys() returns what set() put in, for the active workspace', () => {
    const c = new WorkspaceKeyedCache<number>()
    withWorkspace('workspace-alpha', () => {
      c.set('a', 1)
      c.set('b', 2)
    })

    expect(withWorkspace('workspace-alpha', () => c.workspaceKeys().sort())).toEqual(['a', 'b'])
  })

  it('workspaceKeys() shows one workspace only its own keys', () => {
    const c = new WorkspaceKeyedCache<number>()
    withWorkspace('workspace-alpha', () => c.set('shared-key', 1))
    withWorkspace('workspace-bravo', () => c.set('bravo-only', 2))

    expect(withWorkspace('workspace-alpha', () => c.workspaceKeys())).toEqual(['shared-key'])
    expect(withWorkspace('workspace-bravo', () => c.workspaceKeys())).toEqual(['bravo-only'])
  })

  it('a key listed by workspaceKeys() can be deleted with delete()', () => {
    // The exact round trip a keyed prune performs. With the two methods
    // composing differently this returned nothing to delete, so the ledger
    // never pruned while rows remained.
    const c = new WorkspaceKeyedCache<number>()
    withWorkspace('workspace-alpha', () => {
      c.set('100', 1)
      c.set('200', 2)
      for (const k of c.workspaceKeys()) {
        if (Number(k) < 200) c.delete(k)
      }
    })

    expect(withWorkspace('workspace-alpha', () => c.workspaceKeys())).toEqual(['200'])
    expect(withWorkspace('workspace-alpha', () => c.get('100'))).toBeUndefined()
    expect(withWorkspace('workspace-alpha', () => c.get('200'))).toBe(2)
  })

  it('clearWorkspace() removes exactly what workspaceKeys() listed, and nothing else', () => {
    const c = new WorkspaceKeyedCache<number>()
    withWorkspace('workspace-alpha', () => c.set('a', 1))
    withWorkspace('workspace-bravo', () => c.set('b', 2))

    const listed = withWorkspace('workspace-alpha', () => c.workspaceKeys())
    withWorkspace('workspace-alpha', () => c.clearWorkspace())

    expect(listed).toEqual(['a'])
    expect(withWorkspace('workspace-alpha', () => c.workspaceKeys())).toEqual([])
    expect(withWorkspace('workspace-bravo', () => c.workspaceKeys())).toEqual(['b'])
    expect(withWorkspace('workspace-bravo', () => c.get('b'))).toBe(2)
  })

  it('has()/get()/delete() all address the entry set() wrote', () => {
    const c = new WorkspaceKeyedCache<string>()
    withWorkspace('workspace-alpha', () => {
      c.set('k', 'v')
      expect(c.has('k')).toBe(true)
      expect(c.get('k')).toBe('v')
      expect(c.delete('k')).toBe(true)
      expect(c.has('k')).toBe(false)
    })
  })
})

describe('separation between workspaces', () => {
  it('two workspaces hold the same key independently', () => {
    const c = new WorkspaceKeyedCache<string>()
    withWorkspace('workspace-alpha', () => c.set('same', 'alpha'))
    withWorkspace('workspace-bravo', () => c.set('same', 'bravo'))

    expect(withWorkspace('workspace-alpha', () => c.get('same'))).toBe('alpha')
    expect(withWorkspace('workspace-bravo', () => c.get('same'))).toBe('bravo')
  })

  it('no (namespace, key) pair can collide with another', () => {
    // The reason the separator is NUL and not a space or a colon: a workspace id
    // or key containing the separator would otherwise let two different pairs
    // compose to one string. NUL cannot occur in either.
    const c = new WorkspaceKeyedCache<string>()
    withWorkspace('workspace-a', () => c.set('b:c', 'first'))
    withWorkspace('workspace-a:b', () => c.set('c', 'second'))

    expect(withWorkspace('workspace-a', () => c.get('b:c'))).toBe('first')
    expect(withWorkspace('workspace-a:b', () => c.get('c'))).toBe('second')
  })

  it('memo() resolves once per workspace, not once per process', () => {
    const c = new WorkspaceKeyedCache<string>()
    let calls = 0
    const factory = (t: string) => () => {
      calls += 1
      return t
    }

    expect(withWorkspace('workspace-alpha', () => c.memo('k', factory('alpha')))).toBe('alpha')
    expect(withWorkspace('workspace-alpha', () => c.memo('k', factory('alpha')))).toBe('alpha')
    expect(withWorkspace('workspace-bravo', () => c.memo('k', factory('bravo')))).toBe('bravo')

    expect(calls).toBe(2)
  })
})

describe('the single-workspace namespace', () => {
  it('is a stable `_`, never absent', () => {
    expect(currentWorkspaceNamespace()).toBe('_')
    expect(workspaceScopedKey('settings:workspace')).toBe('w:_:settings:workspace')
  })

  it('is a namespace of its own, not a wildcard', () => {
    const c = new WorkspaceKeyedCache<string>()
    c.set('k', 'unscoped')
    withWorkspace('workspace-alpha', () => c.set('k', 'alpha'))

    expect(c.get('k')).toBe('unscoped')
    expect(withWorkspace('workspace-alpha', () => c.get('k'))).toBe('alpha')
    expect(c.workspaceKeys()).toEqual(['k'])
  })
})

describe('bounding', () => {
  it('evicts oldest-first past maxEntries, across workspaces', () => {
    // The maps this replaces are unbounded, which in a pooled process is a slow
    // leak with a workspace-count multiplier.
    const c = new WorkspaceKeyedCache<number>(2)
    withWorkspace('workspace-alpha', () => c.set('a', 1))
    withWorkspace('workspace-bravo', () => c.set('b', 2))
    withWorkspace('workspace-charlie', () => c.set('c', 3))

    expect(c.size).toBe(2)
    expect(withWorkspace('workspace-alpha', () => c.get('a'))).toBeUndefined()
    expect(withWorkspace('workspace-charlie', () => c.get('c'))).toBe(3)
  })

  it('re-setting a key refreshes its recency rather than adding a second entry', () => {
    const c = new WorkspaceKeyedCache<number>(2)
    withWorkspace('workspace-alpha', () => {
      c.set('a', 1)
      c.set('a', 2)
    })

    expect(c.size).toBe(1)
    expect(withWorkspace('workspace-alpha', () => c.get('a'))).toBe(2)
  })
})
