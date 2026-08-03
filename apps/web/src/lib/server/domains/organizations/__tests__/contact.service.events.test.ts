/**
 * Phase 5: webhook dispatch from contact CRUD.
 *
 * Verifies that `createContact`, `updateContact`, `archiveContact`,
 * `linkContactToUser`, `unlinkContactFromUser`, and `findOrCreateByEmail`
 * fire the matching CRM dispatchers, that `contact.updated` carries the
 * computed changedFields list, and that link/unlink only fire on actual
 * insert / actual delete (not on idempotent hits / no-ops).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const contactFindFirstMock = vi.fn()
const linkFindFirstMock = vi.fn()
const insertReturningMock = vi.fn()
const updateReturningMock = vi.fn()
const deleteReturningMock = vi.fn()
const selectWhereMock = vi.fn()

const dispatchContactCreatedMock = vi.fn()
const dispatchContactUpdatedMock = vi.fn()
const dispatchContactArchivedMock = vi.fn()
const dispatchContactLinkedMock = vi.fn()
const dispatchContactUnlinkedMock = vi.fn()
const buildEventActorMock = vi.fn((input: { principalId: string; userId?: string }) => ({
  type: 'user' as const,
  principalId: input.principalId,
  userId: input.userId,
  displayName: 'contacts-system',
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      contacts: { findFirst: contactFindFirstMock },
      contactUserLinks: { findFirst: linkFindFirstMock, findMany: vi.fn() },
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
    delete: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      returning: deleteReturningMock,
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: selectWhereMock,
      })),
    })),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  ilike: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  user: {
    id: 'user.id',
    email: 'user.email',
    emailVerified: 'user.email_verified',
    isAnonymous: 'user.is_anonymous',
  },
  contacts: {
    id: 'contacts.id',
    email: 'contacts.email',
    externalId: 'contacts.external_id',
    organizationId: 'contacts.organization_id',
    archivedAt: 'contacts.archived_at',
    name: 'contacts.name',
  },
  contactUserLinks: {
    id: 'contact_user_links.id',
    contactId: 'contact_user_links.contact_id',
    userId: 'contact_user_links.user_id',
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
  dispatchContactCreated: (...a: unknown[]) => dispatchContactCreatedMock(...a),
  dispatchContactUpdated: (...a: unknown[]) => dispatchContactUpdatedMock(...a),
  dispatchContactArchived: (...a: unknown[]) => dispatchContactArchivedMock(...a),
  dispatchContactLinked: (...a: unknown[]) => dispatchContactLinkedMock(...a),
  dispatchContactUnlinked: (...a: unknown[]) => dispatchContactUnlinkedMock(...a),
  buildEventActor: (...a: unknown[]) =>
    buildEventActorMock(...(a as [{ principalId: string; userId?: string }])),
}))

beforeEach(() => {
  vi.clearAllMocks()
  selectWhereMock.mockResolvedValue([])
})

const ACTOR = { principalId: 'principal_a' as never, userId: 'user_a' as never }

const SAMPLE_CONTACT = {
  id: 'contact_1',
  name: 'Alice',
  email: 'a@b.test',
  phone: null,
  title: null,
  externalId: null,
  organizationId: null,
  avatarUrl: null,
  metadata: {},
  archivedAt: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

describe('contact.service events (Phase 5)', () => {
  it('dispatches contact.created on create', async () => {
    contactFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_CONTACT])

    const { createContact } = await import('../contact.service')
    await createContact({ email: 'a@b.test', name: 'Alice' }, ACTOR)

    expect(dispatchContactCreatedMock).toHaveBeenCalledTimes(1)
    expect(dispatchContactCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user', principalId: 'principal_a' }),
      SAMPLE_CONTACT
    )
  })

  it('dispatches contact.updated with computed changedFields', async () => {
    contactFindFirstMock.mockResolvedValue(SAMPLE_CONTACT)
    const updated = { ...SAMPLE_CONTACT, name: 'Alicia', title: 'Manager' }
    updateReturningMock.mockResolvedValue([updated])

    const { updateContact } = await import('../contact.service')
    await updateContact('contact_1' as never, { name: 'Alicia', title: 'Manager' }, ACTOR)

    expect(dispatchContactUpdatedMock).toHaveBeenCalledTimes(1)
    const [, , changed] = dispatchContactUpdatedMock.mock.calls[0] as [unknown, unknown, string[]]
    expect(changed.sort()).toEqual(['name', 'title'])
  })

  it('does not fire contact.updated when nothing changes', async () => {
    contactFindFirstMock.mockResolvedValue(SAMPLE_CONTACT)
    updateReturningMock.mockResolvedValue([SAMPLE_CONTACT])

    const { updateContact } = await import('../contact.service')
    await updateContact('contact_1' as never, { name: SAMPLE_CONTACT.name }, ACTOR)

    expect(dispatchContactUpdatedMock).not.toHaveBeenCalled()
  })

  it('dispatches contact.archived on archive', async () => {
    const archived = { ...SAMPLE_CONTACT, archivedAt: new Date('2025-02-01') }
    updateReturningMock.mockResolvedValue([archived])

    const { archiveContact } = await import('../contact.service')
    await archiveContact('contact_1' as never, ACTOR)

    expect(dispatchContactArchivedMock).toHaveBeenCalledTimes(1)
    expect(dispatchContactArchivedMock).toHaveBeenCalledWith(expect.any(Object), archived)
  })

  it('dispatches contact.linked only when a new link is inserted', async () => {
    // No existing link → insert → fire
    linkFindFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock.mockResolvedValueOnce([
      { id: 'cu_link_new', contactId: 'contact_1', userId: 'user_x' },
    ])
    contactFindFirstMock.mockResolvedValueOnce(SAMPLE_CONTACT)

    const { linkContactToUser } = await import('../contact.service')
    await linkContactToUser(
      {
        contactId: 'contact_1' as never,
        userId: 'user_x' as never,
        linkedByPrincipalId: 'principal_a' as never,
      },
      ACTOR
    )

    expect(dispatchContactLinkedMock).toHaveBeenCalledTimes(1)
    expect(dispatchContactLinkedMock).toHaveBeenCalledWith(
      expect.any(Object),
      SAMPLE_CONTACT,
      'user_x',
      'principal_a'
    )
  })

  it('does NOT dispatch contact.linked on idempotent hit (existing link)', async () => {
    linkFindFirstMock.mockResolvedValueOnce({
      id: 'cu_link_existing',
      contactId: 'contact_1',
      userId: 'user_x',
    })

    const { linkContactToUser } = await import('../contact.service')
    await linkContactToUser({ contactId: 'contact_1' as never, userId: 'user_x' as never }, ACTOR)

    expect(dispatchContactLinkedMock).not.toHaveBeenCalled()
  })

  it('dispatches contact.unlinked on actual delete', async () => {
    deleteReturningMock.mockResolvedValueOnce([{ id: 'cu_link_old' }])
    contactFindFirstMock.mockResolvedValueOnce(SAMPLE_CONTACT)

    const { unlinkContactFromUser } = await import('../contact.service')
    await unlinkContactFromUser('contact_1' as never, 'user_x' as never, ACTOR)

    expect(dispatchContactUnlinkedMock).toHaveBeenCalledTimes(1)
    expect(dispatchContactUnlinkedMock).toHaveBeenCalledWith(
      expect.any(Object),
      SAMPLE_CONTACT,
      'user_x'
    )
  })

  it('does NOT dispatch contact.unlinked when no row was deleted', async () => {
    deleteReturningMock.mockResolvedValueOnce([])

    const { unlinkContactFromUser } = await import('../contact.service')
    await unlinkContactFromUser('contact_1' as never, 'user_x' as never, ACTOR)

    expect(dispatchContactUnlinkedMock).not.toHaveBeenCalled()
  })

  it('findOrCreateByEmail fires contact.created only on miss', async () => {
    // Hit branch: no fire
    contactFindFirstMock.mockResolvedValueOnce(SAMPLE_CONTACT)
    const { findOrCreateByEmail } = await import('../contact.service')
    await findOrCreateByEmail({ email: 'a@b.test' }, ACTOR)
    expect(dispatchContactCreatedMock).not.toHaveBeenCalled()

    // Miss branch: fire once
    contactFindFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock.mockResolvedValueOnce([SAMPLE_CONTACT])
    await findOrCreateByEmail({ email: 'a@b.test' }, ACTOR)
    expect(dispatchContactCreatedMock).toHaveBeenCalledTimes(1)
  })

  it('uses service actor when principalId is null', async () => {
    contactFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_CONTACT])

    const { createContact } = await import('../contact.service')
    await createContact({ email: 'a@b.test' }, { principalId: null })

    expect(dispatchContactCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service', displayName: 'contacts-system' }),
      SAMPLE_CONTACT
    )
  })

  it('swallows dispatcher errors', async () => {
    contactFindFirstMock.mockResolvedValue(undefined)
    insertReturningMock.mockResolvedValue([SAMPLE_CONTACT])
    dispatchContactCreatedMock.mockRejectedValueOnce(new Error('hook boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { createContact } = await import('../contact.service')
    const result = await createContact({ email: 'a@b.test' }, ACTOR)

    expect(result).toEqual(SAMPLE_CONTACT)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
