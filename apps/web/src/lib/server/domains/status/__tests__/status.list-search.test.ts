/**
 * listStatusIncidents `search`: filters by title ILIKE, parameterized
 * (the admin list search was previously client-side over loaded pages
 * only, so unloaded incidents silently vanished from results). The db is
 * mocked; the captured WHERE is rendered to SQL via PgDialect so the
 * assertion pins the actual predicate, not call plumbing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockIncidentsFindMany = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      statusIncidents: {
        findMany: (...args: unknown[]) => mockIncidentsFindMany(...args),
        findFirst: vi.fn(),
      },
    },
  },
}))

import { listStatusIncidents } from '../status.service'

function capturedWhereSql(): { sql: string; params: unknown[] } {
  const arg = mockIncidentsFindMany.mock.calls[0][0] as { where: SQL }
  const query = new PgDialect().sqlToQuery(arg.where)
  return { sql: query.sql.toLowerCase(), params: query.params }
}

beforeEach(() => {
  mockIncidentsFindMany.mockReset()
  mockIncidentsFindMany.mockResolvedValue([])
})

describe('listStatusIncidents search', () => {
  it('filters by title ILIKE with a parameterized pattern', async () => {
    await listStatusIncidents({ search: 'api errors' })
    const { sql, params } = capturedWhereSql()
    expect(sql).toContain('"title" ilike')
    expect(params).toContain('%api errors%')
  })

  it('also matches update bodies (operators search for error codes posted in updates)', async () => {
    await listStatusIncidents({ search: 'ECONNRESET' })
    const { sql, params } = capturedWhereSql()
    expect(sql).toContain('exists')
    expect(sql).toContain('"body" ilike')
    expect(params.filter((p) => p === '%ECONNRESET%')).toHaveLength(2)
  })

  it('trims the term and ignores whitespace-only search', async () => {
    await listStatusIncidents({ search: '   ' })
    const { sql } = capturedWhereSql()
    expect(sql).not.toContain('ilike')

    mockIncidentsFindMany.mockClear()
    mockIncidentsFindMany.mockResolvedValue([])
    await listStatusIncidents({ search: '  api  ' })
    expect(capturedWhereSql().params).toContain('%api%')
  })

  it('applies no ILIKE when search is absent', async () => {
    await listStatusIncidents({})
    const { sql } = capturedWhereSql()
    expect(sql).not.toContain('ilike')
  })
})
