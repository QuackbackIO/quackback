import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerPersonListItem } from '../customer-people.service'

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  searchContacts: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  sql: vi.fn(),
  realEmail: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => mocks.dbSelect(...args),
  },
  eq: (...args: unknown[]) => mocks.eq(...args),
  and: (...args: unknown[]) => mocks.and(...args),
  or: (...args: unknown[]) => mocks.or(...args),
  inArray: (...args: unknown[]) => mocks.inArray(...args),
  isNull: (...args: unknown[]) => mocks.isNull(...args),
  asc: (...args: unknown[]) => mocks.asc(...args),
  desc: (...args: unknown[]) => mocks.desc(...args),
  sql: (...args: unknown[]) => mocks.sql(...args),
  contacts: {
    id: 'contacts.id',
    archivedAt: 'contacts.archivedAt',
  },
  organizations: {
    id: 'organizations.id',
    name: 'organizations.name',
  },
  contactUserLinks: {
    contactId: 'contactUserLinks.contactId',
    userId: 'contactUserLinks.userId',
  },
  principal: {
    id: 'principal.id',
    userId: 'principal.userId',
    role: 'principal.role',
    type: 'principal.type',
    createdAt: 'principal.createdAt',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
    image: 'user.image',
    emailVerified: 'user.emailVerified',
  },
  posts: {
    id: 'posts.id',
    principalId: 'posts.principalId',
    deletedAt: 'posts.deletedAt',
  },
  comments: {
    id: 'comments.id',
    principalId: 'comments.principalId',
    deletedAt: 'comments.deletedAt',
  },
  votes: {
    id: 'votes.id',
    principalId: 'votes.principalId',
  },
  tickets: {
    id: 'tickets.id',
    requesterContactId: 'tickets.requesterContactId',
    requesterPrincipalId: 'tickets.requesterPrincipalId',
    deletedAt: 'tickets.deletedAt',
  },
  userSegments: {
    principalId: 'userSegments.principalId',
    segmentId: 'userSegments.segmentId',
  },
  segments: {
    id: 'segments.id',
    name: 'segments.name',
    color: 'segments.color',
    type: 'segments.type',
    deletedAt: 'segments.deletedAt',
  },
}))

vi.mock('../../organizations/contact.service', () => ({
  searchContacts: (...args: unknown[]) => mocks.searchContacts(...args),
}))

vi.mock('@/lib/shared/anonymous-email', () => ({
  realEmail: (...args: unknown[]) => mocks.realEmail(...args),
}))

interface SelectChain {
  from: ReturnType<typeof vi.fn>
  innerJoin: ReturnType<typeof vi.fn>
  leftJoin: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  orderBy: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  offset: ReturnType<typeof vi.fn>
  groupBy: ReturnType<typeof vi.fn>
  as: ReturnType<typeof vi.fn>
  then: Promise<ReadonlyArray<Record<string, unknown>>>['then']
  catch: Promise<ReadonlyArray<Record<string, unknown>>>['catch']
  finally: Promise<ReadonlyArray<Record<string, unknown>>>['finally']
}

function selectRows(rows: ReadonlyArray<Record<string, unknown>>): SelectChain {
  const promise = Promise.resolve(rows)
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    as: vi.fn((alias: string) => ({
      principalId: `${alias}.principalId`,
      postCount: `${alias}.postCount`,
      commentCount: `${alias}.commentCount`,
      voteCount: `${alias}.voteCount`,
    })),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
  return chain
}

function queueSelects(...rowSets: Array<ReadonlyArray<Record<string, unknown>>>) {
  const chains = rowSets.map((rows) => selectRows(rows))
  for (const chain of chains) {
    mocks.dbSelect.mockReturnValueOnce(chain)
  }
  return chains
}

function portalRow(input: {
  principalId: string
  userId: string
  name: string | null
  email: string | null
  image?: string | null
  emailVerified?: boolean
  postCount?: number
  commentCount?: number
  voteCount?: number
}) {
  return {
    principalId: input.principalId,
    userId: input.userId,
    name: input.name,
    email: input.email,
    image: input.image ?? null,
    emailVerified: input.emailVerified ?? false,
    joinedAt: new Date('2026-06-01T00:00:00.000Z'),
    postCount: input.postCount ?? 0,
    commentCount: input.commentCount ?? 0,
    voteCount: input.voteCount ?? 0,
  }
}

function segmentRow(principalId: string, id: string, name: string) {
  return {
    principalId,
    segmentId: id,
    segmentName: name,
    segmentColor: '#2563eb',
    segmentType: 'manual',
  }
}

function itemById(items: CustomerPersonListItem[], id: string) {
  const item = items.find((candidate) => candidate.id === id)
  expect(item).toBeDefined()
  return item as CustomerPersonListItem
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sql.mockReturnValue({ as: vi.fn((alias: string) => alias) })
  mocks.and.mockImplementation((...args: unknown[]) => ({ and: args }))
  mocks.or.mockImplementation((...args: unknown[]) => ({ or: args }))
  mocks.eq.mockImplementation((...args: unknown[]) => ({ eq: args }))
  mocks.inArray.mockImplementation((...args: unknown[]) => ({ inArray: args }))
  mocks.isNull.mockImplementation((arg: unknown) => ({ isNull: arg }))
  mocks.asc.mockImplementation((arg: unknown) => ({ asc: arg }))
  mocks.desc.mockImplementation((arg: unknown) => ({ desc: arg }))
  mocks.realEmail.mockImplementation((email: string | null | undefined) =>
    email?.startsWith('temp-') ? null : (email ?? null)
  )
})

describe('listCustomerPeople', () => {
  it('lists portal-only people when CRM contacts are excluded', async () => {
    queueSelects(
      [{ userId: 'user_b' }, { userId: 'user_a' }],
      [],
      [],
      [],
      [
        portalRow({
          principalId: 'principal_b',
          userId: 'user_b',
          name: 'Beta User',
          email: 'temp-user_b@anon.quackback.io',
          postCount: 2,
          commentCount: 1,
          voteCount: 4,
        }),
        portalRow({
          principalId: 'principal_a',
          userId: 'user_a',
          name: 'Alpha User',
          email: 'alpha@example.com',
          emailVerified: true,
          postCount: 5,
        }),
      ],
      [
        segmentRow('principal_b', 'segment_beta', 'Beta'),
        segmentRow('principal_a', 'segment_alpha', 'Alpha'),
      ],
      [
        { principalId: 'principal_b', count: 3 },
        { principalId: 'principal_a', count: 7 },
      ]
    )

    const { listCustomerPeople } = await import('../customer-people.service')
    const result = await listCustomerPeople({
      includeCrm: false,
      limit: 500,
      offset: -10,
    })

    expect(mocks.searchContacts).not.toHaveBeenCalled()
    expect(result.total).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(result.items.map((item) => item.id)).toEqual(['user:principal_a', 'user:principal_b'])

    const alpha = itemById(result.items, 'user:principal_a')
    expect(alpha).toMatchObject({
      kind: 'portal_user',
      name: 'Alpha User',
      email: 'alpha@example.com',
      hasPortalUser: true,
      emailVerified: true,
      postCount: 5,
      ticketCount: 7,
    })
    expect(alpha.segments).toEqual([
      { id: 'segment_alpha', name: 'Alpha', color: '#2563eb', type: 'manual' },
    ])

    const beta = itemById(result.items, 'user:principal_b')
    expect(beta.email).toBeNull()
    expect(beta.ticketCount).toBe(3)
  })

  it('merges CRM contacts, linked portal users, organizations, segments, and ticket counts', async () => {
    mocks.searchContacts.mockResolvedValue([
      {
        id: 'contact_search',
        name: 'Search Contact',
        email: 'search@example.com',
        avatarUrl: null,
        organizationId: null,
        title: 'Champion',
        phone: null,
        externalId: null,
        archivedAt: null,
      },
    ])

    queueSelects(
      [{ userId: 'user_linked' }, { userId: 'user_only' }],
      [],
      [],
      [],
      [
        portalRow({
          principalId: 'principal_linked',
          userId: 'user_linked',
          name: 'Linked Portal',
          email: 'linked@example.com',
          emailVerified: true,
          postCount: 2,
        }),
        portalRow({
          principalId: 'principal_only',
          userId: 'user_only',
          name: 'Portal Only',
          email: 'portal@example.com',
          commentCount: 3,
        }),
      ],
      [
        segmentRow('principal_linked', 'segment_enterprise', 'Enterprise'),
        segmentRow('principal_only', 'segment_beta', 'Beta'),
      ],
      [{ contactId: 'contact_linked', userId: 'user_linked' }],
      [
        {
          id: 'contact_linked',
          name: 'Linked Contact',
          email: null,
          avatarUrl: null,
          organizationId: 'org_1',
          title: 'Buyer',
          phone: '+1 555',
          externalId: 'crm_1',
          archivedAt: null,
        },
      ],
      [{ contactId: 'contact_linked', userId: 'user_linked' }],
      [],
      [],
      [],
      [
        portalRow({
          principalId: 'principal_linked',
          userId: 'user_linked',
          name: 'Linked Portal',
          email: 'linked@example.com',
          emailVerified: true,
          postCount: 2,
        }),
      ],
      [segmentRow('principal_linked', 'segment_enterprise', 'Enterprise')],
      [{ id: 'org_1', name: 'Acme Inc.' }],
      [
        { contactId: 'contact_linked', count: 2 },
        { contactId: 'contact_search', count: 6 },
      ],
      [
        { principalId: 'principal_linked', count: 5 },
        { principalId: 'principal_only', count: 3 },
      ]
    )

    const { listCustomerPeople } = await import('../customer-people.service')
    const result = await listCustomerPeople({ search: 'portal' })

    expect(mocks.searchContacts).toHaveBeenCalledWith({
      query: 'portal',
      includeArchived: undefined,
      limit: 100,
      offset: 0,
    })
    expect(result.items.map((item) => item.id)).toEqual([
      'contact:contact_linked',
      'user:principal_only',
      'contact:contact_search',
    ])

    const linked = itemById(result.items, 'contact:contact_linked')
    expect(linked).toMatchObject({
      kind: 'linked',
      contactId: 'contact_linked',
      name: 'Linked Contact',
      email: 'linked@example.com',
      organizationId: 'org_1',
      organizationName: 'Acme Inc.',
      title: 'Buyer',
      phone: '+1 555',
      externalId: 'crm_1',
      hasPortalUser: true,
      emailVerified: true,
      postCount: 2,
      ticketCount: 7,
    })
    expect(linked.principalIds).toEqual(['principal_linked'])
    expect(linked.segments).toEqual([
      { id: 'segment_enterprise', name: 'Enterprise', color: '#2563eb', type: 'manual' },
    ])

    const portalOnly = itemById(result.items, 'user:principal_only')
    expect(portalOnly.kind).toBe('portal_user')
    expect(portalOnly.ticketCount).toBe(3)

    const crmOnly = itemById(result.items, 'contact:contact_search')
    expect(crmOnly).toMatchObject({
      kind: 'contact',
      hasPortalUser: false,
      ticketCount: 6,
    })
  })

  it('filters contact rows by linked portal-user segments and skips ticket counts when disabled', async () => {
    mocks.searchContacts.mockResolvedValue([
      {
        id: 'contact_linked',
        name: 'Linked Contact',
        email: 'linked-contact@example.com',
        avatarUrl: null,
        organizationId: null,
        title: null,
        phone: null,
        externalId: null,
        archivedAt: null,
      },
      {
        id: 'contact_without_segment',
        name: 'No Segment',
        email: 'no-segment@example.com',
        avatarUrl: null,
        organizationId: null,
        title: null,
        phone: null,
        externalId: null,
        archivedAt: null,
      },
    ])

    queueSelects(
      [],
      [{ userId: 'user_linked' }],
      [],
      [],
      [],
      [
        portalRow({
          principalId: 'principal_linked',
          userId: 'user_linked',
          name: 'Linked Portal',
          email: 'linked@example.com',
        }),
      ],
      [segmentRow('principal_linked', 'segment_enterprise', 'Enterprise')],
      [{ contactId: 'contact_linked', userId: 'user_linked' }],
      [{ contactId: 'contact_linked', userId: 'user_linked' }],
      [],
      [],
      [],
      [
        portalRow({
          principalId: 'principal_linked',
          userId: 'user_linked',
          name: 'Linked Portal',
          email: 'linked@example.com',
        }),
      ],
      [segmentRow('principal_linked', 'segment_enterprise', 'Enterprise')]
    )

    const { listCustomerPeople } = await import('../customer-people.service')
    const result = await listCustomerPeople({
      segmentIds: ['segment_enterprise' as never],
      includeTicketCounts: false,
    })

    expect(result.items.map((item) => item.id)).toEqual(['contact:contact_linked'])
    expect(result.items[0]).toMatchObject({
      kind: 'linked',
      ticketCount: 0,
      segments: [
        { id: 'segment_enterprise', name: 'Enterprise', color: '#2563eb', type: 'manual' },
      ],
    })
  })
})
