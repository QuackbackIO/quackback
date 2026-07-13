/**
 * Phase 5: webhook dispatch from organization CRUD.
 *
 * Verifies created / updated (with computed changedFields) / archived /
 * unarchived dispatchers fire from the right service entry points, and
 * that `findOrCreateByDomain` only fires on miss (not on hit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const orgFindFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const updateReturningMock = vi.fn()

const dispatchOrganizationCreatedMock = vi.fn()
const dispatchOrganizationUpdatedMock = vi.fn()
const dispatchOrganizationArchivedMock = vi.fn()
const dispatchOrganizationUnarchivedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string; userId?: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  userId: input.userId,
  displayName: 'organizations-system',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      organizations: { findFirst: orgFindFirstMock },
    },
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      returning: insertReturningMock,
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: updateReturningMock,
    })),
    select: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  ilike: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  organizations: {
    id: 'organizations.id',
    domain: 'organizations.domain',
    externalId: 'organizations.external_id',
    archivedAt: 'organizations.archived_at',
    name: 'organizations.name',
  },
}))

vi.mock('@/lib/shared/errors', () => {
  class E extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  }
  return { ConflictError: E, NotFoundError: E, ValidationError: E }
})

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchOrganizationCreated: (...a: unknown[]) => dispatchOrganizationCreatedMock(...a),
  dispatchOrganizationUpdated: (...a: unknown[]) => dispatchOrganizationUpdatedMock(...a),
  dispatchOrganizationArchived: (...a: unknown[]) => dispatchOrganizationArchivedMock(...a),
  dispatchOrganizationUnarchived: (...a: unknown[]) => dispatchOrganizationUnarchivedMock(...a),
  buildEventActor: (...a: unknown[]) =>
    buildEventActorMock(...(a as [{ principalId: string; userId?: string }])),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const ACTOR = { principalId: 'principal_a' as never, userId: 'user_a' as never }

const SAMPLE_ORG = {
  id: 'org_1',
  name: 'Acme',
  domain: 'acme.com',
  externalId: null,
  website: null,
  notes: null,
  metadata: {},
  archivedAt: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

describe('organization.service events (Phase 5)', () => {
  it('dispatches organization.created on create', async () => {
    orgFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_ORG])

    const { createOrganization } = await import('../organization.service')
    await createOrganization({ name: 'Acme', domain: 'acme.com' }, ACTOR)

    expect(dispatchOrganizationCreatedMock).toHaveBeenCalledTimes(1)
    expect(dispatchOrganizationCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user', principalId: 'principal_a' }),
      SAMPLE_ORG
    )
  })

  it('dispatches organization.updated with computed changedFields', async () => {
    orgFindFirstMock.mockResolvedValue(SAMPLE_ORG)
    const updated = { ...SAMPLE_ORG, name: 'Acme Inc.', website: 'https://acme.com' }
    updateReturningMock.mockResolvedValue([updated])

    const { updateOrganization } = await import('../organization.service')
    await updateOrganization(
      'org_1' as never,
      { name: 'Acme Inc.', website: 'https://acme.com' },
      ACTOR
    )

    expect(dispatchOrganizationUpdatedMock).toHaveBeenCalledTimes(1)
    const [, , changed] = dispatchOrganizationUpdatedMock.mock.calls[0] as [
      unknown,
      unknown,
      string[],
    ]
    expect(changed.sort()).toEqual(['name', 'website'])
  })

  it('does not fire organization.updated when nothing changes', async () => {
    orgFindFirstMock.mockResolvedValue(SAMPLE_ORG)
    updateReturningMock.mockResolvedValue([SAMPLE_ORG])

    const { updateOrganization } = await import('../organization.service')
    await updateOrganization('org_1' as never, { name: SAMPLE_ORG.name }, ACTOR)

    expect(dispatchOrganizationUpdatedMock).not.toHaveBeenCalled()
  })

  it('dispatches organization.archived on archive', async () => {
    const archived = { ...SAMPLE_ORG, archivedAt: new Date('2025-02-01') }
    updateReturningMock.mockResolvedValue([archived])

    const { archiveOrganization } = await import('../organization.service')
    await archiveOrganization('org_1' as never, ACTOR)

    expect(dispatchOrganizationArchivedMock).toHaveBeenCalledTimes(1)
    expect(dispatchOrganizationArchivedMock).toHaveBeenCalledWith(expect.any(Object), archived)
  })

  it('dispatches organization.unarchived on unarchive', async () => {
    const restored = { ...SAMPLE_ORG, archivedAt: null }
    updateReturningMock.mockResolvedValue([restored])

    const { unarchiveOrganization } = await import('../organization.service')
    await unarchiveOrganization('org_1' as never, ACTOR)

    expect(dispatchOrganizationUnarchivedMock).toHaveBeenCalledTimes(1)
    expect(dispatchOrganizationUnarchivedMock).toHaveBeenCalledWith(expect.any(Object), restored)
    expect(dispatchOrganizationArchivedMock).not.toHaveBeenCalled()
  })

  it('findOrCreateByDomain fires organization.created only on miss', async () => {
    // Hit branch: no fire
    orgFindFirstMock.mockResolvedValueOnce(SAMPLE_ORG)
    const { findOrCreateByDomain } = await import('../organization.service')
    await findOrCreateByDomain('acme.com', undefined, ACTOR)
    expect(dispatchOrganizationCreatedMock).not.toHaveBeenCalled()

    // Miss branch: fire once
    orgFindFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock.mockResolvedValueOnce([SAMPLE_ORG])
    await findOrCreateByDomain('acme.com', undefined, ACTOR)
    expect(dispatchOrganizationCreatedMock).toHaveBeenCalledTimes(1)
  })

  it('uses service actor when principalId is null', async () => {
    orgFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_ORG])

    const { createOrganization } = await import('../organization.service')
    await createOrganization({ name: 'Acme' }, { principalId: null })

    expect(dispatchOrganizationCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service', displayName: 'organizations-system' }),
      SAMPLE_ORG
    )
  })
})
