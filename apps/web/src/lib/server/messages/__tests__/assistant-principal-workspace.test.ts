/**
 * The assistant's principal id is a row in ONE workspace's database. Memoized
 * process-wide it becomes a foreign key another workspace writes onto its own
 * message rows — and, on the read side, the value every thread loader compares
 * against to decide whose turn is the assistant's.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  /** workspaceKey -> the principal that workspace's database holds, or null. */
  principals: new Map<string, string | null>(),
  lookups: [] as string[],
  currentWorkspaceKey: (): string => '',
}))

vi.mock('@/lib/server/domains/assistant/assistant.principal', () => ({
  getAssistantPrincipal: async () => {
    const id = hoisted.currentWorkspaceKey()
    hoisted.lookups.push(id)
    const found = hoisted.principals.get(id)
    return found ? { id: found } : null
  },
}))

const { assistantPrincipalIdOnce } = await import('../assistant-principal')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')
const { getCurrentWorkspace } = await import('@/lib/server/workspaces/workspace-context')

hoisted.currentWorkspaceKey = () => getCurrentWorkspace()?.workspaceKey ?? ''

beforeEach(() => {
  hoisted.principals.clear()
  hoisted.lookups.length = 0
})

describe('assistantPrincipalIdOnce', () => {
  it('resolves each workspace to its own principal', async () => {
    hoisted.principals.set('workspace-alpha', 'principal_alpha')
    hoisted.principals.set('workspace-bravo', 'principal_bravo')

    expect(await withWorkspace('workspace-alpha', () => assistantPrincipalIdOnce())).toBe(
      'principal_alpha'
    )
    expect(await withWorkspace('workspace-bravo', () => assistantPrincipalIdOnce())).toBe(
      'principal_bravo'
    )
  })

  it('resolves correctly in the other order too', async () => {
    hoisted.principals.set('workspace-charlie', 'principal_charlie')
    hoisted.principals.set('workspace-delta', 'principal_delta')

    expect(await withWorkspace('workspace-delta', () => assistantPrincipalIdOnce())).toBe(
      'principal_delta'
    )
    expect(await withWorkspace('workspace-charlie', () => assistantPrincipalIdOnce())).toBe(
      'principal_charlie'
    )
  })

  it('does not hand a workspace with no assistant another workspace id', async () => {
    hoisted.principals.set('workspace-echo', 'principal_echo')
    await withWorkspace('workspace-echo', () => assistantPrincipalIdOnce())

    expect(await withWorkspace('workspace-foxtrot', () => assistantPrincipalIdOnce())).toBeNull()
  })

  it('still memoizes within a workspace', async () => {
    hoisted.principals.set('workspace-golf', 'principal_golf')

    await withWorkspace('workspace-golf', async () => {
      await assistantPrincipalIdOnce()
      await assistantPrincipalIdOnce()
      await assistantPrincipalIdOnce()
    })

    expect(hoisted.lookups.filter((id) => id === 'workspace-golf')).toHaveLength(1)
  })
})
