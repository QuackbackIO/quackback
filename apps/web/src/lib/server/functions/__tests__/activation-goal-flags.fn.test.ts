import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import {
  DEFAULT_FEATURE_FLAGS,
  resolveFeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import type { SetupState } from '@/lib/server/db'

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  emitPlgEvent: vi.fn(async () => undefined),
  isPathManaged: vi.fn((path: string, paths: string[] | null | undefined) =>
    (paths ?? []).includes(path)
  ),
  row: {
    id: 'ws_1',
    name: 'Acme',
    slug: 'acme',
    managedFieldPaths: [] as string[],
    featureFlags: JSON.stringify({
      feedback: true,
      changelog: true,
      helpCenter: false,
      supportInbox: false,
      supportTickets: false,
      statusPage: false,
    }),
  },
  flagWrites: [] as Record<string, unknown>[],
  state: {
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'product_feedback',
  } as SetupState,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: (args: unknown) => unknown) => fn,
    }
    return chain
  },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/plg-events', () => ({ emitPlgEvent: hoisted.emitPlgEvent }))

vi.mock('@/lib/server/config-file/managed-paths', () => ({
  isPathManaged: hoisted.isPathManaged,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ maxBoards: null })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { settings: { findFirst: vi.fn() }, boards: { findFirst: vi.fn() } },
    select: () => ({ from: () => ({ where: async () => [{ count: 0 }] }) }),
  },
}))

vi.mock('@/lib/server/setup-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/setup-state')>()),
  mutateSetupStateAtomic: async (
    mutate: (
      current: SetupState,
      row: typeof hoisted.row,
      tx: {
        update: (table: unknown) => {
          set: (values: Record<string, unknown>) => { where: () => Promise<void> }
        }
      }
    ) => Promise<{ state: SetupState; value: unknown }> | { state: SetupState; value: unknown }
  ) => {
    const tx = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          hoisted.flagWrites.push(values)
          return { where: async () => undefined }
        },
      }),
    }
    return mutate(hoisted.state, hoisted.row, tx)
  },
}))

const { setActivationGoalFn } = await import('../activation')

beforeEach(() => {
  hoisted.flagWrites = []
  hoisted.row.managedFieldPaths = []
  hoisted.row.featureFlags = JSON.stringify(DEFAULT_FEATURE_FLAGS)
  hoisted.state = {
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'product_feedback',
  }
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'usr_1' },
    principal: { id: 'prn_1', role: 'admin' },
    settings: { id: 'ws_1' },
  })
  hoisted.emitPlgEvent.mockClear()
})

describe('setActivationGoalFn enables the goal modules', () => {
  it('turns Help Center on when the launch-plan goal changes to Help Center', async () => {
    const result = await setActivationGoalFn({ data: { outcome: 'help_center' } } as never)

    expect(result).toEqual({ outcome: 'help_center', enabledModules: ['Help Center'] })
    const written = hoisted.flagWrites.find((values) => typeof values.featureFlags === 'string')
    const flags = resolveFeatureFlags(written!.featureFlags as string)
    expect(flags.helpCenter).toBe(true)
    expect(flags.supportInbox).toBe(false)
  })

  it('returns no newly-enabled modules when the needed flags are already on', async () => {
    hoisted.row.featureFlags = JSON.stringify({
      ...DEFAULT_FEATURE_FLAGS,
      helpCenter: true,
    } satisfies FeatureFlags)

    const result = await setActivationGoalFn({ data: { outcome: 'help_center' } } as never)

    expect(result).toEqual({ outcome: 'help_center', enabledModules: [] })
  })

  it('refuses a managed goal without writing flags', async () => {
    hoisted.row.managedFieldPaths = ['workspace.useCase']

    await expect(
      setActivationGoalFn({ data: { outcome: 'help_center' } } as never)
    ).rejects.toThrow(/managed/i)
    expect(hoisted.flagWrites).toEqual([])
  })
})
