/**
 * Differential-coverage tests for organization.service — create/update
 * validation + dup checks, the field-by-field update ternaries + changed-field
 * diff, fireOrganizationEvent (actor + kind + failure), archive/unarchive,
 * list filters, and findOrCreateByDomain race recovery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  orgFindFirst: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  selectWhere: vi.fn(),
  buildEventActor: vi.fn((..._a: unknown[]) => ({
    type: 'principal',
    displayName: 'organizations-system',
  })),
  dCreated: vi.fn(),
  dUpdated: vi.fn(),
  dArchived: vi.fn(),
  dUnarchived: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { organizations: { findFirst: m.orgFindFirst } },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    select: () => {
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
  asc: vi.fn(),
  desc: vi.fn(),
  organizations: {
    id: 'o.id',
    domain: 'o.domain',
    externalId: 'o.externalId',
    name: 'o.name',
    archivedAt: 'o.archivedAt',
    createdAt: 'o.createdAt',
  },
}))

vi.mock('../normalize', () => ({
  normalizeDomain: (d: unknown) =>
    typeof d === 'string' && d.includes('.') ? d.trim().toLowerCase() : '',
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchOrganizationCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchOrganizationUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchOrganizationArchived: (...a: unknown[]) => m.dArchived(...a),
  dispatchOrganizationUnarchived: (...a: unknown[]) => m.dUnarchived(...a),
}))

import * as svc from '../organization.service'

const withP = { principalId: 'p1' as never, userId: 'u1' as never }

beforeEach(() => {
  vi.clearAllMocks()
  m.orgFindFirst.mockResolvedValue(undefined)
  m.insertReturning.mockResolvedValue([{ id: 'org_1', name: 'Acme' }])
  m.updateReturning.mockResolvedValue([{ id: 'org_1' }])
  m.selectWhere.mockResolvedValue([{ id: 'org_1' }])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('createOrganization', () => {
  it('requires a name', async () => {
    await expect(svc.createOrganization({ name: '  ' })).rejects.toThrow('name is required')
  })
  it('rejects an over-long name', async () => {
    await expect(svc.createOrganization({ name: 'x'.repeat(201) })).rejects.toThrow('exceeds')
  })
  it('rejects an invalid domain', async () => {
    await expect(svc.createOrganization({ name: 'N', domain: 'nodot' })).rejects.toThrow(
      'domain is invalid'
    )
  })
  it('rejects a duplicate domain', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'dup' })
    await expect(svc.createOrganization({ name: 'N', domain: 'acme.com' })).rejects.toThrow(
      'already exists'
    )
  })
  it('rejects a duplicate externalId', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'dup' }) // externalId check (no domain)
    await expect(svc.createOrganization({ name: 'N', externalId: 'ext' })).rejects.toThrow(
      'externalId already in use'
    )
  })
  it('creates and fires created (service actor)', async () => {
    const o = await svc.createOrganization({
      name: ' Acme ',
      domain: 'acme.com',
      website: 'w',
      notes: 'n',
    })
    expect(o).toEqual({ id: 'org_1', name: 'Acme' })
    expect(m.dCreated).toHaveBeenCalled()
    expect(m.buildEventActor).not.toHaveBeenCalled()
  })
})

describe('updateOrganization', () => {
  it('throws when missing', async () => {
    m.orgFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.updateOrganization('o1' as never, { name: 'x' })).rejects.toThrow('not found')
  })
  it('rejects an invalid domain', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o1', domain: 'old.com' })
    await expect(svc.updateOrganization('o1' as never, { domain: 'bad' })).rejects.toThrow(
      'domain is invalid'
    )
  })
  it('rejects a domain taken by another org', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o1', domain: 'old.com' })
    m.orgFindFirst.mockResolvedValueOnce({ id: 'other' })
    await expect(svc.updateOrganization('o1' as never, { domain: 'new.com' })).rejects.toThrow(
      'already exists'
    )
  })
  it('rejects an externalId taken by another org', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o1', externalId: 'old' })
    m.orgFindFirst.mockResolvedValueOnce({ id: 'other' })
    await expect(svc.updateOrganization('o1' as never, { externalId: 'new' })).rejects.toThrow(
      'externalId already in use'
    )
  })
  it('rejects an over-long name', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o1' })
    await expect(svc.updateOrganization('o1' as never, { name: 'x'.repeat(201) })).rejects.toThrow(
      'exceeds'
    )
  })
  it('updates all fields, diffs changes, and fires updated', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o1', domain: 'old.com', name: 'old' })
    m.updateReturning.mockResolvedValueOnce([
      { id: 'o1', domain: 'new.com', name: 'New', externalId: 'e', website: 'w', notes: 'n' },
    ])
    await svc.updateOrganization(
      'o1' as never,
      {
        name: ' New ',
        domain: 'new.com',
        externalId: 'e',
        website: 'w',
        notes: 'n',
        metadata: {} as never,
      },
      withP
    )
    expect(m.dUpdated).toHaveBeenCalled()
    expect(m.buildEventActor).toHaveBeenCalled()
  })
  it('makes no changes for empty input (no event)', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o1', name: 'old', domain: 'old.com' })
    m.updateReturning.mockResolvedValueOnce([{ id: 'o1', name: 'old', domain: 'old.com' }])
    await svc.updateOrganization('o1' as never, {})
    expect(m.dUpdated).not.toHaveBeenCalled()
  })
})

describe('archive / unarchive + getters', () => {
  it('archive fires when a row is returned, not when empty', async () => {
    await svc.archiveOrganization('o1' as never, withP)
    expect(m.dArchived).toHaveBeenCalled()
    m.updateReturning.mockResolvedValueOnce([])
    await svc.archiveOrganization('o1' as never)
    expect(m.dArchived).toHaveBeenCalledTimes(1)
  })
  it('unarchive fires when a row is returned, not when empty', async () => {
    await svc.unarchiveOrganization('o1' as never)
    expect(m.dUnarchived).toHaveBeenCalled()
    m.updateReturning.mockResolvedValueOnce([])
    await svc.unarchiveOrganization('o1' as never)
    expect(m.dUnarchived).toHaveBeenCalledTimes(1)
  })
  it('getOrganization returns null when missing', async () => {
    expect(await svc.getOrganization('o1' as never)).toBeNull()
  })
  it('getOrganizationByDomain: null for invalid, row for valid', async () => {
    expect(await svc.getOrganizationByDomain('bad')).toBeNull()
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o1' })
    expect(await svc.getOrganizationByDomain('acme.com')).toEqual({ id: 'o1' })
  })
})

describe('listOrganizations', () => {
  it('applies search + active filter and default sort', async () => {
    expect(
      await svc.listOrganizations({
        search: ' acme ',
        includeArchived: false,
        limit: 9999,
        offset: -1,
      })
    ).toEqual([{ id: 'org_1' }])
  })
  it('runs with no filters (includeArchived true, where undefined)', async () => {
    expect(await svc.listOrganizations({ includeArchived: true })).toEqual([{ id: 'org_1' }])
  })
})

describe('findOrCreateByDomain', () => {
  it('rejects an invalid domain', async () => {
    await expect(svc.findOrCreateByDomain('bad')).rejects.toThrow('is invalid')
  })
  it('returns an existing org', async () => {
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o_exist' })
    expect(await svc.findOrCreateByDomain('acme.com')).toEqual({ id: 'o_exist' })
  })
  it('creates with a fallback name and fires created', async () => {
    const o = await svc.findOrCreateByDomain('acme.com', ' Acme Inc ')
    expect(o).toEqual({ id: 'org_1', name: 'Acme' })
    expect(m.dCreated).toHaveBeenCalled()
  })
  it('recovers from an insert race', async () => {
    m.orgFindFirst.mockResolvedValueOnce(undefined) // initial lookup
    m.insertReturning.mockRejectedValueOnce(new Error('unique violation'))
    m.orgFindFirst.mockResolvedValueOnce({ id: 'o_race' }) // after
    expect(await svc.findOrCreateByDomain('acme.com')).toEqual({ id: 'o_race' })
  })
  it('rethrows when recovery also misses', async () => {
    m.orgFindFirst.mockResolvedValueOnce(undefined)
    m.insertReturning.mockRejectedValueOnce(new Error('boom'))
    m.orgFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.findOrCreateByDomain('acme.com')).rejects.toThrow('boom')
  })
})

describe('fireOrganizationEvent failure', () => {
  it('swallows dispatch errors', async () => {
    m.dCreated.mockRejectedValueOnce(new Error('boom'))
    await svc.createOrganization({ name: 'N' })
    expect(console.warn).toHaveBeenCalled()
  })
})
