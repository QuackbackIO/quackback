/**
 * Focused unit tests for contact.service exercising validation, email
 * normalisation, dedupe, and link idempotency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const contactFindFirstMock = vi.fn()
const linkFindFirstMock = vi.fn()
const linkFindManyMock = vi.fn()
const insertReturningMock = vi.fn()
const selectWhereMock = vi.fn()
const selectFromMock = vi.fn(() => ({ where: selectWhereMock }))
const selectMock = vi.fn<() => unknown>(() => ({ from: selectFromMock }))

vi.mock('@/lib/server/db', () => {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: insertReturningMock,
  }
  return {
    db: {
      query: {
        contacts: { findFirst: contactFindFirstMock },
        contactUserLinks: { findFirst: linkFindFirstMock, findMany: linkFindManyMock },
      },
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => ({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn(),
      })),
      delete: vi.fn(() => ({ where: vi.fn() })),
      select: selectMock,
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
  }
})

vi.mock('@/lib/shared/errors', () => ({
  ConflictError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
  NotFoundError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
  ValidationError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  contactFindFirstMock.mockReset()
  linkFindFirstMock.mockReset()
  linkFindManyMock.mockReset()
  insertReturningMock.mockReset()
  selectMock.mockClear()
  selectFromMock.mockClear()
  selectWhereMock.mockReset()
})

function makeListChain(rows: unknown[]) {
  const promise = Promise.resolve(rows)
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
  return chain
}

describe('createContact', () => {
  it('rejects when neither name nor email is provided', async () => {
    const { createContact } = await import('../contact.service')
    await expect(createContact({})).rejects.toThrow(/name or email/i)
  })

  it('rejects when email is malformed', async () => {
    const { createContact } = await import('../contact.service')
    await expect(createContact({ name: 'Bob', email: 'not-an-email' })).rejects.toThrow(/invalid/i)
  })

  it('throws ConflictError when email already exists', async () => {
    contactFindFirstMock.mockResolvedValueOnce({ id: 'contact_x', email: 'a@b.com' })
    const { createContact } = await import('../contact.service')
    await expect(createContact({ email: 'A@B.com' })).rejects.toThrow(/already exists/i)
  })

  it('inserts with normalised email on success', async () => {
    contactFindFirstMock.mockResolvedValue(undefined)
    selectWhereMock.mockResolvedValueOnce([])
    insertReturningMock.mockResolvedValueOnce([{ id: 'contact_new', email: 'a@b.com' }])
    const { createContact } = await import('../contact.service')
    const result = await createContact({ email: 'A@B.COM' })
    expect(result.id).toBe('contact_new')
  })

  it('links matching verified portal users after contact creation', async () => {
    contactFindFirstMock.mockResolvedValue(undefined)
    selectWhereMock.mockResolvedValueOnce([{ id: 'user_verified' }])
    linkFindFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock
      .mockResolvedValueOnce([{ id: 'contact_new', email: 'a@b.com', archivedAt: null }])
      .mockResolvedValueOnce([
        { id: 'cu_link_new', contactId: 'contact_new', userId: 'user_verified' },
      ])

    const { createContact } = await import('../contact.service')
    await createContact({ email: 'A@B.COM' })

    expect(selectMock).toHaveBeenCalled()
    expect(selectWhereMock).toHaveBeenCalled()
    expect(linkFindFirstMock).toHaveBeenCalled()
    expect(insertReturningMock).toHaveBeenCalledTimes(2)
  })
})

describe('findOrCreateByEmail', () => {
  it('returns existing contact when email matches', async () => {
    contactFindFirstMock.mockResolvedValueOnce({ id: 'contact_existing', email: 'a@b.com' })
    const { findOrCreateByEmail } = await import('../contact.service')
    const result = await findOrCreateByEmail({ email: 'A@B.com' })
    expect(result.id).toBe('contact_existing')
  })

  it('creates a new contact when no match', async () => {
    contactFindFirstMock.mockResolvedValueOnce(undefined)
    selectWhereMock.mockResolvedValueOnce([])
    insertReturningMock.mockResolvedValueOnce([{ id: 'contact_new', email: 'a@b.com' }])
    const { findOrCreateByEmail } = await import('../contact.service')
    const result = await findOrCreateByEmail({ email: 'a@b.com' })
    expect(result.id).toBe('contact_new')
  })

  it('rejects invalid email', async () => {
    const { findOrCreateByEmail } = await import('../contact.service')
    await expect(findOrCreateByEmail({ email: 'garbage' })).rejects.toThrow(/invalid/i)
  })
})

describe('contact list and search queries', () => {
  it('lists contacts for an organization with capped limits and clamped offsets', async () => {
    const rows = [{ id: 'contact_1', organizationId: 'org_1' }]
    const chain = makeListChain(rows)
    selectMock.mockReturnValueOnce(chain)

    const { listContactsForOrganization } = await import('../contact.service')
    await expect(
      listContactsForOrganization('org_1' as never, { limit: 500, offset: -10 })
    ).resolves.toEqual(rows)

    expect(chain.limit).toHaveBeenCalledWith(200)
    expect(chain.offset).toHaveBeenCalledWith(0)
  })

  it('searches contacts with optional email, organization, text, and archived filters', async () => {
    const rows = [{ id: 'contact_1', email: 'a@b.com' }]
    const filteredChain = makeListChain(rows)
    selectMock.mockReturnValueOnce(filteredChain)

    const { searchContacts } = await import('../contact.service')
    await expect(
      searchContacts({
        email: ' A@B.COM ',
        organizationId: 'org_1' as never,
        query: ' Alice ',
        limit: 150,
        offset: -1,
      })
    ).resolves.toEqual(rows)

    expect(filteredChain.limit).toHaveBeenCalledWith(100)
    expect(filteredChain.offset).toHaveBeenCalledWith(0)

    const unfilteredChain = makeListChain([])
    selectMock.mockReturnValueOnce(unfilteredChain)
    await expect(searchContacts({ includeArchived: true })).resolves.toEqual([])
    expect(unfilteredChain.where).toHaveBeenCalledWith(undefined)
  })
})

describe('linkContactToUser', () => {
  it('returns existing link when one is present (idempotent)', async () => {
    linkFindFirstMock.mockResolvedValueOnce({
      id: 'cu_link_existing',
      contactId: 'contact_x',
      userId: 'user_x',
    })
    const { linkContactToUser } = await import('../contact.service')
    const result = await linkContactToUser({
      contactId: 'contact_x' as never,
      userId: 'user_x' as never,
    })
    expect(result.id).toBe('cu_link_existing')
  })

  it('creates a new link when none exists', async () => {
    linkFindFirstMock.mockResolvedValueOnce(undefined)
    insertReturningMock.mockResolvedValueOnce([
      { id: 'cu_link_new', contactId: 'contact_x', userId: 'user_x' },
    ])
    const { linkContactToUser } = await import('../contact.service')
    const result = await linkContactToUser({
      contactId: 'contact_x' as never,
      userId: 'user_x' as never,
    })
    expect(result.id).toBe('cu_link_new')
  })
})

describe('contact-user link helpers', () => {
  it('unlinks by link id and lists links by contact or user', async () => {
    linkFindManyMock
      .mockResolvedValueOnce([{ id: 'link_contact', contactId: 'contact_x' }])
      .mockResolvedValueOnce([{ id: 'link_user', userId: 'user_x' }])

    const { unlinkById, listLinksForContact, listLinksForUser } = await import('../contact.service')
    await expect(unlinkById('link_1' as never)).resolves.toBeUndefined()
    await expect(listLinksForContact('contact_x' as never)).resolves.toEqual([
      { id: 'link_contact', contactId: 'contact_x' },
    ])
    await expect(listLinksForUser('user_x' as never)).resolves.toEqual([
      { id: 'link_user', userId: 'user_x' },
    ])
  })
})
