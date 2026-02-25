import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindFirst = vi.fn()
const mockDeleteReturning = vi.fn()
const mockNotifyUserSyncIntegrations = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      segments: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: (...args: unknown[]) => mockDeleteReturning(...args),
      })),
    })),
  },
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  sql: Object.assign(vi.fn(), {
    raw: vi.fn(),
    join: vi.fn(),
  }),
  segments: {
    id: 'id',
    deletedAt: 'deleted_at',
  },
  userSegments: {
    segmentId: 'segment_id',
    principalId: 'principal_id',
    addedBy: 'added_by',
  },
}))

vi.mock('@/lib/server/integrations/user-sync-notify', () => ({
  notifyUserSyncIntegrations: (...args: unknown[]) => mockNotifyUserSyncIntegrations(...args),
}))

describe('evaluateDynamicSegment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('notifies removed users when a dynamic segment has no rules', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'segment_test123',
      name: 'Enterprise',
      description: null,
      type: 'dynamic',
      color: '#6b7280',
      rules: null,
      evaluationSchedule: null,
      weightConfig: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    })
    mockDeleteReturning.mockResolvedValue([
      { principalId: 'principal_a' },
      { principalId: 'principal_b' },
    ])
    mockNotifyUserSyncIntegrations.mockResolvedValue(undefined)

    const { evaluateDynamicSegment } = await import('../segment.service')

    const result = await evaluateDynamicSegment('segment_test123' as never)

    expect(result).toEqual({
      segmentId: 'segment_test123',
      added: 0,
      removed: 2,
    })
    await vi.waitFor(() => {
      expect(mockNotifyUserSyncIntegrations).toHaveBeenCalledTimes(1)
    })
    expect(mockNotifyUserSyncIntegrations).toHaveBeenCalledWith(
      'Enterprise',
      [],
      ['principal_a', 'principal_b']
    )
  })
})
