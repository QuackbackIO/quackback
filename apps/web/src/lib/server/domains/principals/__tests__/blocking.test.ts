/**
 * Blocking guards + read/write behavior (support platform §4.6). Team members
 * and service principals can never be blocked; end users can. isBlocked reads
 * the blocked_at flag; unblock clears both columns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

let findFirstRow: Record<string, unknown> | undefined
const setPayloads: Record<string, unknown>[] = []

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.where = () => c
    c.set = (p: Record<string, unknown>) => {
      setPayloads.push(p)
      return c
    }
    return c
  }
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      update: () => chain(),
      query: { principal: { findFirst: async () => findFirstRow } },
    },
    eq: vi.fn(),
    sql: (() => 'now()') as unknown,
  }
})

import { block, unblock, isBlocked, getBlockStatus } from '../blocking'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'

const TARGET = 'principal_target' as PrincipalId
const ACTOR = 'principal_actor' as PrincipalId

beforeEach(() => {
  findFirstRow = undefined
  setPayloads.length = 0
  vi.clearAllMocks()
})

describe('isBlocked / getBlockStatus', () => {
  it('is true when blocked_at is set, false when null', async () => {
    findFirstRow = { blockedAt: new Date('2026-07-01T00:00:00Z') }
    expect(await isBlocked(TARGET)).toBe(true)
    findFirstRow = { blockedAt: null }
    expect(await isBlocked(TARGET)).toBe(false)
  })

  it('is false for an unknown principal (no row)', async () => {
    findFirstRow = undefined
    expect(await isBlocked(TARGET)).toBe(false)
  })

  it('getBlockStatus returns the ISO block time or null', async () => {
    findFirstRow = { blockedAt: new Date('2026-07-01T00:00:00Z') }
    expect(await getBlockStatus(TARGET)).toEqual({ blockedAt: '2026-07-01T00:00:00.000Z' })
    findFirstRow = { blockedAt: null }
    expect(await getBlockStatus(TARGET)).toEqual({ blockedAt: null })
  })
})

describe('block guards', () => {
  it('refuses to block a team member', async () => {
    findFirstRow = { id: TARGET, role: 'member', type: 'user', blockedAt: null }
    await expect(block(TARGET, ACTOR)).rejects.toBeInstanceOf(ForbiddenError)
    findFirstRow = { id: TARGET, role: 'admin', type: 'user', blockedAt: null }
    await expect(block(TARGET, ACTOR)).rejects.toBeInstanceOf(ForbiddenError)
    expect(setPayloads).toHaveLength(0)
  })

  it('refuses to block a service principal', async () => {
    findFirstRow = { id: TARGET, role: 'user', type: 'service', blockedAt: null }
    await expect(block(TARGET, ACTOR)).rejects.toBeInstanceOf(ForbiddenError)
    expect(setPayloads).toHaveLength(0)
  })

  it('throws NotFound for an unknown principal', async () => {
    findFirstRow = undefined
    await expect(block(TARGET, ACTOR)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('block / unblock', () => {
  it('blocks an end user, stamping blocked_at + the acting teammate', async () => {
    findFirstRow = { id: TARGET, role: 'user', type: 'user', blockedAt: null }
    await block(TARGET, ACTOR)
    expect(setPayloads).toHaveLength(1)
    expect(setPayloads[0].blockedAt).toBeTruthy()
    expect(setPayloads[0].blockedByPrincipalId).toBe(ACTOR)
  })

  it('blocks an anonymous visitor', async () => {
    findFirstRow = { id: TARGET, role: 'user', type: 'anonymous', blockedAt: null }
    await block(TARGET, ACTOR)
    expect(setPayloads).toHaveLength(1)
  })

  it('is idempotent — an already-blocked person keeps the original block', async () => {
    findFirstRow = {
      id: TARGET,
      role: 'user',
      type: 'user',
      blockedAt: new Date('2026-06-01T00:00:00Z'),
    }
    await block(TARGET, ACTOR)
    expect(setPayloads).toHaveLength(0)
  })

  it('unblock clears both columns', async () => {
    await unblock(TARGET)
    expect(setPayloads).toHaveLength(1)
    expect(setPayloads[0]).toEqual({ blockedAt: null, blockedByPrincipalId: null })
  })
})
