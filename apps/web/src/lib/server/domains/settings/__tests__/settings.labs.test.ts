import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindFirst = vi.fn()
const mockSelectRows = vi.fn()
const mockSelectLimit = vi.fn()
const mockUpdateReturning = vi.fn()
const mockUpdateSet = vi.fn()
const mockInsertReturning = vi.fn()
const mockOnConflictDoUpdate = vi.fn()
const mockOnConflictDoNothing = vi.fn()
const mockCacheDel = vi.fn()
const mockRecordAuditEvent = vi.fn()

vi.mock('@/lib/server/cache', () => ({
  CACHE_KEYS: {
    WORKSPACE_SETTINGS: 'settings:workspace',
    REGISTERED_AUTH_PROVIDERS: 'auth:registered-providers',
  },
}))

vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvDel: (...args: unknown[]) => mockCacheDel(...args),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      query: {
        settings: {
          findFirst: (...args: unknown[]) => mockFindFirst(...args),
        },
      },
      select: () => ({
        from: () => ({
          where: () => {
            const rows = mockSelectRows()
            return Object.assign(Promise.resolve(rows), {
              limit: () => mockSelectLimit(),
            })
          },
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          mockUpdateSet(values)
          return {
            where: () => ({
              returning: () => mockUpdateReturning(),
            }),
          }
        },
      }),
      insert: () => ({
        values: (values: unknown) => ({
          onConflictDoUpdate: (conflict: unknown) => {
            mockOnConflictDoUpdate(values, conflict)
            return {
              returning: () => mockInsertReturning(),
            }
          },
          onConflictDoNothing: (conflict: unknown) => {
            mockOnConflictDoNothing(values, conflict)
            return Promise.resolve()
          },
        }),
      }),
    },
  }
})

const {
  setWorkspaceExperimentEnabled,
  setOperatorExperimentColumn,
  operatorConflictSet,
  workspaceEnableUpdateSet,
  loadLabsProjection,
  ensureNewWorkspaceLabs,
} = await import('../settings.labs')

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue({ id: 'workspace_1' })
  mockCacheDel.mockResolvedValue(undefined)
  mockRecordAuditEvent.mockResolvedValue(undefined)
  mockSelectRows.mockReturnValue([])
  mockSelectLimit.mockResolvedValue([])
  mockUpdateReturning.mockResolvedValue([])
  mockInsertReturning.mockResolvedValue([{ visible: false, enabled: false }])
})

describe('column-specific updates', () => {
  it('updates only the intended boolean plus updatedAt', () => {
    expect(workspaceEnableUpdateSet()).toEqual(['enabled', 'updatedAt'])
    expect(operatorConflictSet('visible')).toEqual(['visible', 'updatedAt'])
    expect(operatorConflictSet('enabled')).toEqual(['enabled', 'updatedAt'])
  })
})

describe('ensureNewWorkspaceLabs', () => {
  it('inserts Refreshed UI on and does not overwrite an existing row', async () => {
    await ensureNewWorkspaceLabs('workspace_1')
    expect(mockOnConflictDoNothing).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          settingsId: 'workspace_1',
          experimentId: 'refined-visual-theme',
          visible: true,
          enabled: true,
        }),
      ],
      expect.objectContaining({ target: expect.anything() })
    )
  })
})

describe('loadLabsProjection', () => {
  it('normalizes missing rows to legacy and no visible cards', async () => {
    await expect(loadLabsProjection('workspace_1')).resolves.toEqual({
      visualTheme: 'legacy',
      visibleExperiments: [],
    })
  })

  it('resolves refined while omitting a hidden enabled experiment from cards', async () => {
    mockSelectRows.mockReturnValue([
      { experimentId: 'refined-visual-theme', visible: false, enabled: true },
    ])
    await expect(loadLabsProjection('workspace_1')).resolves.toEqual({
      visualTheme: 'refined',
      visibleExperiments: [],
    })
  })
})

describe('setWorkspaceExperimentEnabled', () => {
  it('rejects unknown ids before writing', async () => {
    await expect(
      setWorkspaceExperimentEnabled({
        experimentId: 'not-registered',
        enabled: true,
        actor: { email: 'admin@example.com' },
      })
    ).rejects.toMatchObject({ code: 'UNKNOWN_EXPERIMENT' })
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('rejects non-boolean enabled values', async () => {
    await expect(
      setWorkspaceExperimentEnabled({
        experimentId: 'refined-visual-theme',
        enabled: 'true' as unknown as boolean,
        actor: { email: 'admin@example.com' },
      })
    ).rejects.toMatchObject({ code: 'INVALID_EXPERIMENT_ENABLED' })
  })

  it('rejects activation when the row is hidden at write time', async () => {
    mockSelectLimit.mockResolvedValue([{ visible: false, enabled: false }])
    mockUpdateReturning.mockResolvedValue([])

    await expect(
      setWorkspaceExperimentEnabled({
        experimentId: 'refined-visual-theme',
        enabled: true,
        actor: { email: 'admin@example.com' },
      })
    ).rejects.toMatchObject({ code: 'EXPERIMENT_NOT_AVAILABLE' })
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(Object.keys(mockUpdateSet.mock.calls[0]![0] as object).sort()).toEqual([
      'enabled',
      'updatedAt',
    ])
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
    expect(mockCacheDel).not.toHaveBeenCalled()
  })

  it('is a no-op when already at the requested enabled value', async () => {
    mockSelectLimit.mockResolvedValue([{ visible: true, enabled: true }])
    mockUpdateReturning.mockResolvedValue([])

    await expect(
      setWorkspaceExperimentEnabled({
        experimentId: 'refined-visual-theme',
        enabled: true,
        actor: { email: 'admin@example.com' },
      })
    ).resolves.toEqual({ visible: true, enabled: true })
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
    expect(mockCacheDel).not.toHaveBeenCalled()
  })

  it('audits and invalidates cache when enablement changes', async () => {
    mockSelectLimit.mockResolvedValue([{ visible: true, enabled: false }])
    mockUpdateReturning.mockResolvedValue([{ visible: true, enabled: true }])

    await expect(
      setWorkspaceExperimentEnabled({
        experimentId: 'refined-visual-theme',
        enabled: true,
        actor: { email: 'admin@example.com', type: 'user' },
      })
    ).resolves.toEqual({ visible: true, enabled: true })

    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'labs.experiment.changed',
        before: expect.objectContaining({ experimentId: 'refined-visual-theme', enabled: false }),
        after: expect.objectContaining({ experimentId: 'refined-visual-theme', enabled: true }),
        metadata: expect.objectContaining({ source: 'workspace' }),
      })
    )
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('does not report success when cache invalidation fails', async () => {
    mockSelectLimit.mockResolvedValue([{ visible: true, enabled: false }])
    mockUpdateReturning.mockResolvedValue([{ visible: true, enabled: true }])
    mockCacheDel.mockRejectedValue(new Error('kv down'))

    await expect(
      setWorkspaceExperimentEnabled({
        experimentId: 'refined-visual-theme',
        enabled: true,
        actor: { email: 'admin@example.com' },
      })
    ).rejects.toMatchObject({ code: 'SETTINGS_CACHE_INVALIDATION_FAILED' })
  })
})

describe('setOperatorExperimentColumn', () => {
  it('upserts only the visibility column', async () => {
    mockSelectLimit.mockResolvedValue([])
    mockInsertReturning.mockResolvedValue([{ visible: true, enabled: false }])

    await expect(
      setOperatorExperimentColumn({
        experimentId: 'refined-visual-theme',
        column: 'visible',
        value: true,
        actor: { type: 'service', email: 'operator:cli' },
      })
    ).resolves.toEqual({ visible: true, enabled: false })

    const [, conflict] = mockOnConflictDoUpdate.mock.calls[0] as [
      unknown,
      { set: Record<string, unknown> },
    ]
    expect(Object.keys(conflict.set).sort()).toEqual(['updatedAt', 'visible'])
    expect(conflict.set).not.toHaveProperty('enabled')
  })

  it('can enable a hidden experiment without exposing it', async () => {
    mockSelectLimit.mockResolvedValue([{ visible: false, enabled: false }])
    mockInsertReturning.mockResolvedValue([{ visible: false, enabled: true }])

    await expect(
      setOperatorExperimentColumn({
        experimentId: 'refined-visual-theme',
        column: 'enabled',
        value: true,
        actor: { type: 'service', email: 'operator:cli' },
      })
    ).resolves.toEqual({ visible: false, enabled: true })

    const [, conflict] = mockOnConflictDoUpdate.mock.calls[0] as [
      unknown,
      { set: Record<string, unknown> },
    ]
    expect(Object.keys(conflict.set).sort()).toEqual(['enabled', 'updatedAt'])
    expect(conflict.set).not.toHaveProperty('visible')
  })

  it('skips audit noise when the column is already at the requested value', async () => {
    mockSelectLimit.mockResolvedValue([{ visible: true, enabled: false }])
    mockInsertReturning.mockResolvedValue([{ visible: true, enabled: false }])

    await setOperatorExperimentColumn({
      experimentId: 'refined-visual-theme',
      column: 'visible',
      value: true,
      actor: { type: 'service', email: 'operator:cli' },
    })

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
    expect(mockCacheDel).not.toHaveBeenCalled()
  })
})
