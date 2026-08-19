import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  setupState: '',
  forUpdate: vi.fn(),
  invalidation: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: hoisted.invalidation,
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  let transactionTail = Promise.resolve()

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(() => ({
          for: hoisted.forUpdate.mockImplementation(async () => [
            {
              id: 'workspace_1',
              setupState: hoisted.setupState,
            },
          ]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: { setupState: string }) => ({
        where: vi.fn(async () => {
          hoisted.setupState = values.setupState
        }),
      })),
    })),
  }

  return {
    ...actual,
    db: {
      transaction: vi.fn(<T>(callback: (executor: typeof tx) => Promise<T>) => {
        const result = transactionTail.then(() => callback(tx))
        transactionTail = result.then(
          () => undefined,
          () => undefined
        )
        return result
      }),
    },
  }
})

const { mutateSetupStateAtomic } = await import('../setup-state')

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.setupState = JSON.stringify({
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'product_feedback',
  })
})

describe('mutateSetupStateAtomic', () => {
  it('preserves unrelated fields across simultaneous mutations', async () => {
    await Promise.all([
      mutateSetupStateAtomic(async (current) => {
        await Promise.resolve()
        return {
          state: { ...current, useCase: 'internal' },
          value: undefined,
        }
      }),
      mutateSetupStateAtomic((current) => ({
        state: { ...current, activationHandoffSeenAt: '2026-07-13T10:00:00.000Z' },
        value: undefined,
      })),
    ])

    const stored = JSON.parse(hoisted.setupState)
    expect(stored.useCase).toBe('internal')
    expect(stored.activationHandoffSeenAt).toBe('2026-07-13T10:00:00.000Z')
    expect(stored.steps.workspace).toBe(true)
    expect(hoisted.forUpdate).toHaveBeenCalledTimes(2)
    expect(hoisted.invalidation).toHaveBeenCalledTimes(2)
  })

  it('lazily persists normalized legacy JSON on the next write', async () => {
    hoisted.setupState = JSON.stringify({
      version: 1,
      steps: { core: true, workspace: true, boards: true },
      completedAt: '2026-01-01T00:00:00.000Z',
    })

    await mutateSetupStateAtomic((current) => ({ state: current, value: undefined }))

    const stored = JSON.parse(hoisted.setupState)
    expect(stored.version).toBe(2)
    expect(stored.steps.startingPoint.source).toBe('existing')
    expect(stored.activationHandoffSeenAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
