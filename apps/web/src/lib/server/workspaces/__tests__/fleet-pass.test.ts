/**
 * `runFleetPass` opens a scope for every active workspace — except the ones
 * nobody has visited past the dormancy threshold, which it must not open at all
 * (opening the scope is the cost the rule exists to remove).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR = 3_600_000
const listActiveWorkspaces = vi.fn()
const acquireWorkspaceScope = vi.fn()
const acquireScopeForWorkspaceId = vi.fn()

vi.mock('@/lib/server/config', () => ({
  config: { isPooledTenancy: true, workspaceDormantAfterHours: 168 },
}))
vi.mock('../registry', () => ({ listActiveWorkspaces, getControlSql: () => ({}) }))
vi.mock('../resolver', () => ({ acquireWorkspaceScope, acquireScopeForWorkspaceId }))
vi.mock('../workspace-context', () => ({
  runWithWorkspaceScope: async (_scope: unknown, body: () => Promise<unknown>) => body(),
}))

function ws(workspaceKey: string, lastActiveAt: Date | null) {
  return { workspaceKey, revision: 1, lastActiveAt }
}

beforeEach(async () => {
  vi.clearAllMocks()
  ;(await import('../activity')).__resetWorkspaceActivityForTests()
  acquireWorkspaceScope.mockImplementation(async (workspace: { workspaceKey: string }) => ({
    kind: 'ok',
    scope: { workspace },
  }))
})

describe('runFleetPass', () => {
  it('skips dormant workspaces without opening a scope, and counts them', async () => {
    const now = Date.now()
    listActiveWorkspaces.mockResolvedValue({
      workspaces: [
        ws('inst_live', new Date(now - HOUR)),
        ws('inst_idle', new Date(now - 200 * HOUR)),
        ws('inst_unstamped', null),
      ],
      refused: [],
    })
    const { runFleetPass } = await import('../fleet')
    const visited: string[] = []
    const result = await runFleetPass('sweep', async (workspace) => {
      visited.push(workspace!.workspaceKey)
    })

    expect(visited).toEqual(['inst_live', 'inst_unstamped'])
    expect(acquireWorkspaceScope).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ succeeded: 2, failed: 0, skipped: 0, dormant: 1 })
  })

  it('still visits an idle workspace the worker is keeping awake for standing work', async () => {
    const now = Date.now()
    listActiveWorkspaces.mockResolvedValue({
      workspaces: [ws('inst_idle', new Date(now - 200 * HOUR))],
      refused: [],
    })
    const { markStandingWork } = await import('../activity')
    markStandingWork('inst_idle', true)
    const { runFleetPass } = await import('../fleet')
    const result = await runFleetPass('sweep', async () => {})
    expect(result).toEqual({ succeeded: 1, failed: 0, skipped: 0, dormant: 0 })
  })
})

it('explicit maintenance scripts include dormant workspaces without changing sweep defaults', async () => {
  listActiveWorkspaces.mockResolvedValue({
    workspaces: [ws('inst_idle', new Date(Date.now() - 200 * HOUR))],
    refused: [],
  })
  const { runFleetPass } = await import('../fleet')
  const body = vi.fn()
  expect(await runFleetPass('script', body, { includeDormant: true })).toEqual({
    succeeded: 1,
    failed: 0,
    skipped: 0,
    dormant: 0,
  })
  expect(body).toHaveBeenCalledOnce()
  expect(await runFleetPass('sweep', body, { includeDormant: true })).toEqual({
    succeeded: 0,
    failed: 0,
    skipped: 0,
    dormant: 1,
  })
})
