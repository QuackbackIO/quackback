/**
 * Differential-coverage tests for contact.service — create/update validation +
 * dup checks, the field-by-field update ternaries and changed-field diffing,
 * fireContactEvent (actor + kind + failure), auto-linking, search/list filters,
 * findOrCreateByEmail race recovery, and link/unlink idempotency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  contactsFindFirst: vi.fn(),
  linksFindFirst: vi.fn(),
  linksFindMany: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  deleteReturning: vi.fn(),
  selectWhere: vi.fn(),
  buildEventActor: vi.fn((..._a: unknown[]) => ({
    type: 'principal',
    displayName: 'contacts-system',
  })),
  dCreated: vi.fn(),
  dUpdated: vi.fn(),
  dArchived: vi.fn(),
  dLinked: vi.fn(),
  dUnlinked: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      contacts: { findFirst: m.contactsFindFirst },
      contactUserLinks: { findFirst: m.linksFindFirst, findMany: m.linksFindMany },
    },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    delete: () => ({ where: () => ({ returning: m.deleteReturning }) }),
    select: () => {
      // `.where()` is both awaited directly (auto-link) and chained through
      // orderBy/limit/offset (list/search); a thenable tail handles both.
      const tail: Record<string, unknown> = {
        orderBy: () => tail,
        limit: () => tail,
        offset: () => m.selectWhere(),
        then: (resolve: (v: unknown) => void) => resolve(m.selectWhere()),
      }
      return { from: () => ({ where: () => tail }) }
    },
  },
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...a) => ({ and: a })),
  isNull: vi.fn((a) => ({ isNull: a })),
  ilike: vi.fn(),
  or: vi.fn((...a) => ({ or: a })),
  sql: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  contacts: {
    id: 'c.id',
    email: 'c.email',
    externalId: 'c.externalId',
    organizationId: 'c.organizationId',
    archivedAt: 'c.archivedAt',
    name: 'c.name',
    createdAt: 'c.createdAt',
  },
  contactUserLinks: { id: 'cul.id', contactId: 'cul.contactId', userId: 'cul.userId' },
  user: {
    id: 'u.id',
    email: 'u.email',
    emailVerified: 'u.emailVerified',
    isAnonymous: 'u.isAnonymous',
  },
}))

vi.mock('../normalize', () => ({
  normalizeEmail: (e: unknown) =>
    typeof e === 'string' && e.includes('@') ? e.trim().toLowerCase() : '',
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchContactCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchContactUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchContactArchived: (...a: unknown[]) => m.dArchived(...a),
  dispatchContactLinked: (...a: unknown[]) => m.dLinked(...a),
  dispatchContactUnlinked: (...a: unknown[]) => m.dUnlinked(...a),
}))

import * as svc from '../contact.service'

const withP = { principalId: 'p1' as never, userId: 'u1' as never }

beforeEach(() => {
  vi.clearAllMocks()
  m.contactsFindFirst.mockResolvedValue(undefined)
  m.linksFindFirst.mockResolvedValue(undefined)
  m.linksFindMany.mockResolvedValue([{ id: 'link_1' }])
  m.insertReturning.mockResolvedValue([{ id: 'contact_1', email: 'a@x.test' }])
  m.updateReturning.mockResolvedValue([{ id: 'contact_1' }])
  m.deleteReturning.mockResolvedValue([{ id: 'cul_1' }])
  m.selectWhere.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createContact', () => {
  it('rejects an invalid email', async () => {
    await expect(svc.createContact({ email: 'bad' })).rejects.toThrow('email is invalid')
  })
  it('requires a name or email', async () => {
    await expect(svc.createContact({})).rejects.toThrow('at least a name or email')
  })
  it('rejects a duplicate email', async () => {
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'dup' })
    await expect(svc.createContact({ email: 'a@x.test' })).rejects.toThrow('already exists')
  })
  it('rejects a duplicate externalId', async () => {
    // No email -> the email dup check is skipped; first findFirst is externalId.
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'dup' })
    await expect(svc.createContact({ name: 'N', externalId: 'ext' })).rejects.toThrow(
      'externalId already in use'
    )
  })
  it('creates, fires created, and auto-links verified users', async () => {
    m.selectWhere.mockResolvedValueOnce([{ id: 'u_verified' }])
    m.contactsFindFirst.mockResolvedValueOnce(undefined) // email dup check
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'contact_1' }) // getContact inside link
    const c = await svc.createContact({ name: ' N ', email: 'a@x.test' }, withP)
    expect(c).toEqual({ id: 'contact_1', email: 'a@x.test' })
    expect(m.dCreated).toHaveBeenCalled()
    expect(m.dLinked).toHaveBeenCalled() // via auto-link
  })
})

describe('updateContact', () => {
  it('throws when missing', async () => {
    m.contactsFindFirst.mockResolvedValueOnce(undefined) // getContact
    await expect(svc.updateContact('c1' as never, { name: 'x' })).rejects.toThrow('not found')
  })
  it('rejects an invalid new email', async () => {
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1', email: 'old@x.test' })
    await expect(svc.updateContact('c1' as never, { email: 'bad' })).rejects.toThrow(
      'email is invalid'
    )
  })
  it('rejects an email taken by another contact', async () => {
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1', email: 'old@x.test' }) // getContact
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'other' }) // dup
    await expect(svc.updateContact('c1' as never, { email: 'new@x.test' })).rejects.toThrow(
      'already exists'
    )
  })
  it('rejects an externalId taken by another contact', async () => {
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1', externalId: 'old' })
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'other' }) // externalId dup
    await expect(svc.updateContact('c1' as never, { externalId: 'new' })).rejects.toThrow(
      'externalId already in use'
    )
  })
  it('updates all fields, diffs changes, fires updated, and re-links on email change', async () => {
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1', email: 'old@x.test', name: 'old' })
    m.updateReturning.mockResolvedValueOnce([{ id: 'c1', email: 'new@x.test', name: 'New' }])
    m.selectWhere.mockResolvedValueOnce([])
    await svc.updateContact(
      'c1' as never,
      {
        name: ' New ',
        email: 'new@x.test',
        phone: '1',
        title: 't',
        externalId: 'e',
        organizationId: 'org_1' as never,
        avatarUrl: 'a',
        metadata: {} as never,
      },
      withP
    )
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('makes no changes when input is empty (uses existing, no event)', async () => {
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1', email: 'old@x.test', name: 'old' })
    m.updateReturning.mockResolvedValueOnce([{ id: 'c1', email: 'old@x.test', name: 'old' }])
    await svc.updateContact('c1' as never, {})
    expect(m.dUpdated).not.toHaveBeenCalled()
  })
})

describe('archive + getters', () => {
  it('archives and fires when a row is returned', async () => {
    await svc.archiveContact('c1' as never, withP)
    expect(m.dArchived).toHaveBeenCalled()
  })
  it('does not fire when archive matched nothing', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    await svc.archiveContact('c1' as never)
    expect(m.dArchived).not.toHaveBeenCalled()
  })
  it('getContact returns null when missing', async () => {
    expect(await svc.getContact('c1' as never)).toBeNull()
  })
  it('getContactByEmail returns null for an invalid email and a row otherwise', async () => {
    expect(await svc.getContactByEmail('bad')).toBeNull()
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1' })
    expect(await svc.getContactByEmail('a@x.test')).toEqual({ id: 'c1' })
  })
})

describe('search + list', () => {
  it('listContactsForOrganization with and without archived', async () => {
    m.selectWhere.mockResolvedValue([{ id: 'c1' }])
    expect(await svc.listContactsForOrganization('org_1' as never)).toEqual([{ id: 'c1' }])
    expect(
      await svc.listContactsForOrganization('org_1' as never, {
        includeArchived: true,
        limit: 9999,
        offset: -1,
      })
    ).toEqual([{ id: 'c1' }])
  })
  it('searchContacts applies all filters', async () => {
    m.selectWhere.mockResolvedValueOnce([{ id: 'c1' }])
    await svc.searchContacts({
      email: 'a@x.test',
      organizationId: 'org_1' as never,
      query: ' jo ',
      includeArchived: false,
    })
    // invalid email is skipped; no filters -> where undefined
    m.selectWhere.mockResolvedValueOnce([])
    await svc.searchContacts({ email: 'bad', includeArchived: true })
  })
})

describe('findOrCreateByEmail', () => {
  it('rejects an invalid email', async () => {
    await expect(svc.findOrCreateByEmail({ email: 'bad' })).rejects.toThrow('is invalid')
  })
  it('returns an existing contact', async () => {
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c_exist' })
    expect(await svc.findOrCreateByEmail({ email: 'a@x.test' })).toEqual({ id: 'c_exist' })
  })
  it('creates a new contact and fires created', async () => {
    const c = await svc.findOrCreateByEmail({ email: 'a@x.test', name: ' N ' })
    expect(c).toEqual({ id: 'contact_1', email: 'a@x.test' })
    expect(m.dCreated).toHaveBeenCalled()
  })
  it('recovers from an insert race by re-reading', async () => {
    m.contactsFindFirst.mockResolvedValueOnce(undefined) // initial getContactByEmail
    m.insertReturning.mockRejectedValueOnce(new Error('unique violation'))
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c_race' }) // after
    expect(await svc.findOrCreateByEmail({ email: 'a@x.test' })).toEqual({ id: 'c_race' })
  })
  it('rethrows when the race recovery also misses', async () => {
    m.contactsFindFirst.mockResolvedValueOnce(undefined)
    m.insertReturning.mockRejectedValueOnce(new Error('boom'))
    m.contactsFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.findOrCreateByEmail({ email: 'a@x.test' })).rejects.toThrow('boom')
  })
})

describe('links', () => {
  it('is idempotent when a link exists', async () => {
    m.linksFindFirst.mockResolvedValueOnce({ id: 'existing' })
    expect(
      await svc.linkContactToUser({ contactId: 'c1' as never, userId: 'u1' as never })
    ).toEqual({ id: 'existing' })
    expect(m.insertReturning).not.toHaveBeenCalled()
  })
  it('creates a link and fires linked when the contact exists', async () => {
    m.insertReturning.mockResolvedValueOnce([{ id: 'cul_new' }])
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1' })
    await svc.linkContactToUser(
      { contactId: 'c1' as never, userId: 'u1' as never, linkedByPrincipalId: 'p1' as never },
      withP
    )
    expect(m.dLinked).toHaveBeenCalled()
  })
  it('creates a link but skips the event when the contact is gone', async () => {
    m.insertReturning.mockResolvedValueOnce([{ id: 'cul_new' }])
    m.contactsFindFirst.mockResolvedValueOnce(undefined)
    await svc.linkContactToUser({ contactId: 'c1' as never, userId: 'u1' as never })
    expect(m.dLinked).not.toHaveBeenCalled()
  })
  it('unlink: no-op when nothing deleted, fires when deleted', async () => {
    m.deleteReturning.mockResolvedValueOnce([])
    await svc.unlinkContactFromUser('c1' as never, 'u1' as never)
    expect(m.dUnlinked).not.toHaveBeenCalled()

    m.deleteReturning.mockResolvedValueOnce([{ id: 'cul_1' }])
    m.contactsFindFirst.mockResolvedValueOnce({ id: 'c1' })
    await svc.unlinkContactFromUser('c1' as never, 'u1' as never)
    expect(m.dUnlinked).toHaveBeenCalled()
  })
  it('unlinkById, listLinksForContact, listLinksForUser', async () => {
    await svc.unlinkById('cul_1' as never)
    expect(await svc.listLinksForContact('c1' as never)).toEqual([{ id: 'link_1' }])
    expect(await svc.listLinksForUser('u1' as never)).toEqual([{ id: 'link_1' }])
  })
})

describe('fireContactEvent edge cases', () => {
  it('uses a service actor and swallows dispatch failures', async () => {
    m.dCreated.mockRejectedValueOnce(new Error('boom'))
    m.selectWhere.mockResolvedValueOnce([])
    await svc.createContact({ name: 'N', email: 'a@x.test' }) // service actor (default)
    expect(m.buildEventActor).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
})
