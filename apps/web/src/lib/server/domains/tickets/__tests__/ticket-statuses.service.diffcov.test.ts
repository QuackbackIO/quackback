/**
 * Differential-coverage tests for ticket-statuses.service — list/get/default,
 * create/update/archive with validation (name/slug/category), single-default
 * enforcement, no-op update, system-status guard, and event dispatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  selectOrderBy: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  buildEventActor: vi.fn((..._a: unknown[]) => ({
    type: 'principal',
    displayName: 'ticket-status-system',
  })),
  dCreated: vi.fn(),
  dUpdated: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { ticketStatuses: { findFirst: m.findFirst } },
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => m.selectOrderBy() }) }) }),
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: m.updateReturning,
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  ticketStatuses: {
    id: 'ts.id',
    slug: 'ts.slug',
    isDefault: 'ts.isDefault',
    deletedAt: 'ts.deletedAt',
    position: 'ts.position',
    name: 'ts.name',
  },
  TICKET_STATUS_CATEGORIES: ['open', 'pending', 'on_hold', 'solved', 'closed'],
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchTicketStatusCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchTicketStatusUpdated: (...a: unknown[]) => m.dUpdated(...a),
}))

import * as svc from '../ticket-statuses.service'

const withP = { principalId: 'p1' as never, userId: 'u1' as never }
const svcActor = { principalId: null }

beforeEach(() => {
  vi.clearAllMocks()
  m.findFirst.mockResolvedValue(undefined)
  m.selectOrderBy.mockResolvedValue([{ id: 'st_1' }])
  m.insertReturning.mockResolvedValue([{ id: 'st_1', name: 'Open' }])
  m.updateReturning.mockResolvedValue([{ id: 'st_1', name: 'Open' }])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('list / get / default', () => {
  it('listTicketStatuses with and without deleted', async () => {
    expect(await svc.listTicketStatuses()).toEqual([{ id: 'st_1' }])
    expect(await svc.listTicketStatuses({ includeDeleted: true })).toEqual([{ id: 'st_1' }])
  })
  it('getTicketStatus returns null when missing', async () => {
    expect(await svc.getTicketStatus('st_1' as never)).toBeNull()
  })
  it('getDefaultTicketStatus returns the default or null', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'st_default' })
    expect(await svc.getDefaultTicketStatus()).toEqual({ id: 'st_default' })
    expect(await svc.getDefaultTicketStatus()).toBeNull()
  })
})

describe('createTicketStatus', () => {
  it('requires a name', async () => {
    await expect(
      svc.createTicketStatus({ name: ' ', slug: 'open', category: 'open' } as never, svcActor)
    ).rejects.toThrow('name is required')
  })
  it('rejects an invalid slug', async () => {
    await expect(
      svc.createTicketStatus({ name: 'N', slug: 'Bad Slug', category: 'open' } as never, svcActor)
    ).rejects.toThrow('slug must match')
  })
  it('rejects an invalid category', async () => {
    await expect(
      svc.createTicketStatus({ name: 'N', slug: 'open', category: 'bogus' } as never, svcActor)
    ).rejects.toThrow('invalid category')
  })
  it('rejects a duplicate slug', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'dup' })
    await expect(
      svc.createTicketStatus({ name: 'N', slug: 'open', category: 'open' } as never, svcActor)
    ).rejects.toThrow('already exists')
  })
  it('creates as default (resets others) and fires created with principal actor', async () => {
    const row = await svc.createTicketStatus(
      { name: ' Open ', slug: 'OPEN', category: 'open', isDefault: true } as never,
      withP
    )
    expect(row).toEqual({ id: 'st_1', name: 'Open' })
    expect(m.buildEventActor).toHaveBeenCalled()
    expect(m.dCreated).toHaveBeenCalled()
  })
  it('creates with defaults and a service actor', async () => {
    await svc.createTicketStatus(
      { name: 'N', slug: 'pending', category: 'pending' } as never,
      svcActor
    )
    expect(m.buildEventActor).not.toHaveBeenCalled()
  })
})

describe('updateTicketStatus', () => {
  it('throws when missing', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.updateTicketStatus('st_1' as never, { name: 'x' }, svcActor)).rejects.toThrow(
      'not found'
    )
  })
  it('rejects an invalid category', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'st_1' })
    await expect(
      svc.updateTicketStatus('st_1' as never, { category: 'bogus' as never }, svcActor)
    ).rejects.toThrow('invalid category')
  })
  it('returns existing unchanged when patch is empty', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'st_1', name: 'keep' })
    expect(await svc.updateTicketStatus('st_1' as never, {}, svcActor)).toEqual({
      id: 'st_1',
      name: 'keep',
    })
    expect(m.updateReturning).not.toHaveBeenCalled()
  })
  it('applies all fields, resets default, and fires updated', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'st_1' })
    await svc.updateTicketStatus(
      'st_1' as never,
      { name: ' New ', color: '#fff', category: 'solved', position: 2, isDefault: true },
      withP
    )
    expect(m.dUpdated).toHaveBeenCalled()
  })
})

describe('archiveTicketStatus', () => {
  it('throws when missing', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.archiveTicketStatus('st_1' as never, svcActor)).rejects.toThrow('not found')
  })
  it('refuses to archive a system status', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'st_1', isSystem: true })
    await expect(svc.archiveTicketStatus('st_1' as never, svcActor)).rejects.toThrow(
      'system statuses'
    )
  })
  it('archives and fires updated with deletedAt', async () => {
    m.findFirst.mockResolvedValueOnce({ id: 'st_1', isSystem: false })
    await svc.archiveTicketStatus('st_1' as never, withP)
    expect(m.dUpdated).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['deletedAt'])
  })
})

describe('fireStatusEvent failure', () => {
  it('swallows dispatch errors', async () => {
    m.dCreated.mockRejectedValueOnce(new Error('boom'))
    await svc.createTicketStatus({ name: 'N', slug: 'open', category: 'open' } as never, svcActor)
    expect(console.warn).toHaveBeenCalled()
  })
})
