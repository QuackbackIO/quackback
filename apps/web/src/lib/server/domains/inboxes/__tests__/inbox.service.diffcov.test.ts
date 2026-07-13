/**
 * Differential-coverage tests for inbox.service — create/update/archive/
 * unarchive with their validation, no-op, and not-found branches, the
 * event-dispatch actor (principal vs service) + failure swallow, and the
 * listInboxes filter matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  inboxesFindFirst: vi.fn(),
  txInsertReturning: vi.fn(),
  membershipValues: vi.fn(),
  updateReturning: vi.fn(),
  selectOffset: vi.fn(),
  buildEventActor: vi.fn((..._a: unknown[]) => ({
    type: 'principal',
    displayName: 'inbox-system',
  })),
  dispatchCreated: vi.fn(),
  dispatchUpdated: vi.fn(),
  dispatchArchived: vi.fn(),
  dispatchUnarchived: vi.fn(),
}))

vi.mock('@/lib/server/db', () => {
  const tx = {
    insert: (_table: unknown) => ({
      values: (v: unknown) => {
        // membership insert is awaited (no returning); inbox insert uses returning
        return {
          returning: m.txInsertReturning,
          then: (r: (x: unknown) => void) => r(m.membershipValues(v)),
        }
      },
    }),
  }
  return {
    db: {
      query: { inboxes: { findFirst: m.inboxesFindFirst } },
      transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
      update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit: () => ({ offset: m.selectOffset }) }) }),
        }),
      }),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn((...a) => ({ or: a })),
    asc: vi.fn(),
    inboxes: {
      id: 'i.id',
      slug: 'i.slug',
      name: 'i.name',
      primaryTeamId: 'i.primaryTeamId',
      archivedAt: 'i.archivedAt',
    },
    inboxMemberships: {},
  }
})

vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchInboxCreated: (...a: unknown[]) => m.dispatchCreated(...a),
  dispatchInboxUpdated: (...a: unknown[]) => m.dispatchUpdated(...a),
  dispatchInboxArchived: (...a: unknown[]) => m.dispatchArchived(...a),
  dispatchInboxUnarchived: (...a: unknown[]) => m.dispatchUnarchived(...a),
}))

import {
  createInbox,
  updateInbox,
  archiveInbox,
  unarchiveInbox,
  getInbox,
  getInboxBySlug,
  listInboxes,
} from '../inbox.service'

const actorP = { principalId: 'p1' as never, userId: 'u1' as never }
const actorS = { principalId: null }

beforeEach(() => {
  vi.clearAllMocks()
  m.inboxesFindFirst.mockResolvedValue(undefined)
  m.txInsertReturning.mockResolvedValue([{ id: 'inbox_1', name: 'A' }])
  m.membershipValues.mockReturnValue(undefined)
  m.updateReturning.mockResolvedValue([{ id: 'inbox_1', name: 'A' }])
  m.selectOffset.mockResolvedValue([{ id: 'inbox_1' }])
  m.dispatchCreated.mockResolvedValue(undefined)
  m.dispatchUpdated.mockResolvedValue(undefined)
  m.dispatchArchived.mockResolvedValue(undefined)
  m.dispatchUnarchived.mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createInbox', () => {
  it('rejects an empty name', async () => {
    await expect(createInbox({ name: '  ', slug: 'a' }, actorS)).rejects.toThrow('name is required')
  })

  it('rejects an over-long name', async () => {
    await expect(createInbox({ name: 'x'.repeat(201), slug: 'a' }, actorS)).rejects.toThrow(
      'exceeds'
    )
  })

  it('rejects an empty/invalid/too-long slug', async () => {
    await expect(createInbox({ name: 'n', slug: '' }, actorS)).rejects.toThrow('slug is required')
    await expect(createInbox({ name: 'n', slug: 'Bad Slug!' }, actorS)).rejects.toThrow('lowercase')
    await expect(createInbox({ name: 'n', slug: 'a'.repeat(101) }, actorS)).rejects.toThrow(
      'exceeds'
    )
  })

  it('rejects a duplicate slug', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'dup' })
    await expect(createInbox({ name: 'n', slug: 'sales' }, actorS)).rejects.toThrow(
      'already exists'
    )
  })

  it('creates with an owner membership and a principal actor', async () => {
    const res = await createInbox({ name: 'Sales', slug: 'sales' }, actorP)
    expect(res).toEqual({ id: 'inbox_1', name: 'A' })
    expect(m.membershipValues).toHaveBeenCalled()
    expect(m.buildEventActor).toHaveBeenCalled()
    expect(m.dispatchCreated).toHaveBeenCalled()
  })

  it('creates with a service actor (no membership) and swallows dispatch failure', async () => {
    m.dispatchCreated.mockRejectedValueOnce(new Error('boom'))
    await createInbox(
      { name: 'Sales', slug: 'sales', description: 'd', primaryTeamId: 'team_1' as never },
      actorS
    )
    expect(m.membershipValues).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('updateInbox', () => {
  it('throws when the inbox is missing', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce(undefined)
    await expect(updateInbox('inbox_x' as never, { name: 'n' }, actorS)).rejects.toThrow(
      'not found'
    )
  })

  it('validates the new name', async () => {
    m.inboxesFindFirst.mockResolvedValue({ id: 'inbox_1' })
    await expect(updateInbox('inbox_1' as never, { name: '  ' }, actorS)).rejects.toThrow(
      'name is required'
    )
    await expect(
      updateInbox('inbox_1' as never, { name: 'x'.repeat(201) }, actorS)
    ).rejects.toThrow('exceeds')
  })

  it('returns existing unchanged when patch is empty', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_1', name: 'keep' })
    const res = await updateInbox('inbox_1' as never, {}, actorS)
    expect(res).toEqual({ id: 'inbox_1', name: 'keep' })
    expect(m.updateReturning).not.toHaveBeenCalled()
  })

  it('applies all provided fields and dispatches updated', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_1' })
    await updateInbox(
      'inbox_1' as never,
      {
        name: 'New',
        description: null,
        primaryTeamId: null,
        defaultVisibilityScope: 'workspace' as never,
        defaultPriority: 'high' as never,
        defaultStatusId: 'st_1' as never,
        color: '#fff',
        icon: 'x',
      },
      actorP
    )
    expect(m.dispatchUpdated).toHaveBeenCalled()
  })
})

describe('archive / unarchive', () => {
  it('archive: not found, already archived, and success', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce(undefined)
    await expect(archiveInbox('x' as never, actorS)).rejects.toThrow('not found')

    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_1', archivedAt: new Date() })
    expect((await archiveInbox('inbox_1' as never, actorS)).id).toBe('inbox_1')

    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_1', archivedAt: null })
    await archiveInbox('inbox_1' as never, actorS)
    expect(m.dispatchArchived).toHaveBeenCalled()
  })

  it('unarchive: not found, not archived, and success', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce(undefined)
    await expect(unarchiveInbox('x' as never, actorS)).rejects.toThrow('not found')

    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_1', archivedAt: null })
    await unarchiveInbox('inbox_1' as never, actorS)
    expect(m.dispatchUnarchived).not.toHaveBeenCalled()

    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_1', archivedAt: new Date() })
    await unarchiveInbox('inbox_1' as never, actorS)
    expect(m.dispatchUnarchived).toHaveBeenCalled()
  })
})

describe('getters + listInboxes', () => {
  it('getInbox and getInboxBySlug query findFirst', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_1' })
    expect(await getInbox('inbox_1' as never)).toEqual({ id: 'inbox_1' })
    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_2' })
    expect(await getInboxBySlug('Sales')).toEqual({ id: 'inbox_2' })
  })

  it('lists with all filters', async () => {
    const res = await listInboxes({
      includeArchived: true,
      primaryTeamId: 'team_1' as never,
      search: 'sup',
      limit: 10,
      offset: 5,
    })
    expect(res).toEqual([{ id: 'inbox_1' }])
  })

  it('lists with defaults (active only, no filters)', async () => {
    const res = await listInboxes()
    expect(res).toEqual([{ id: 'inbox_1' }])
  })
})
