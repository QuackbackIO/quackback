/**
 * Tests for the dry-run preview (§I2): validates and resolves every row
 * without writing anything, and marks rows as create/update based on a
 * source-id match against prior import links.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findFirstPostStatuses: vi.fn(),
  findManyPostStatuses: vi.fn(),
  findManyPostTags: vi.fn(),
  findManyBoards: vi.fn(),
  findManyPostExternalLinks: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      postStatuses: {
        findFirst: hoisted.findFirstPostStatuses,
        findMany: hoisted.findManyPostStatuses,
      },
      postTags: { findMany: hoisted.findManyPostTags },
      boards: { findMany: hoisted.findManyBoards },
      postExternalLinks: { findMany: hoisted.findManyPostExternalLinks },
    },
    insert: hoisted.insert,
  },
  postStatuses: { isDefault: 'is_default' },
  postExternalLinks: { integrationType: 'integration_type', externalId: 'external_id' },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
}))

// previewImport constructs its own resolver internally (no injection point),
// so the resolver itself is faked: a brand-new email increments pendingCount
// exactly once, mirroring the real class's queue-for-creation behavior.
vi.mock('../user-resolver', () => {
  class FakeImportUserResolver {
    private seen = new Map<string, string>()
    private pending = 0
    async resolve(email: string | null, _name: string | null, fallback: string) {
      if (!email) return fallback
      const key = email.toLowerCase()
      if (this.seen.has(key)) return this.seen.get(key)!
      this.pending++
      const id = `principal_${key}`
      this.seen.set(key, id)
      return id
    }
    async flushPendingCreates() {
      return 0
    }
    get pendingCount() {
      return this.pending
    }
  }
  return { ImportUserResolver: FakeImportUserResolver }
})

import { previewImport } from '../import-preview'

const BASE_INPUT = {
  boardId: 'board_01h455vb4pex5vsknk084sn02q' as never,
  totalRows: 2,
  initiatedByPrincipalId: 'principal_admin' as never,
}

function csvContent(csv: string): string {
  return Buffer.from(csv).toString('base64')
}

describe('previewImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.findFirstPostStatuses.mockResolvedValue(undefined)
    hoisted.findManyPostStatuses.mockResolvedValue([
      { id: 'status_open', slug: 'open', category: 'active', name: 'Open' },
    ])
    hoisted.findManyPostTags.mockResolvedValue([])
    hoisted.findManyBoards.mockResolvedValue([{ id: 'board_bugs', slug: 'bugs', name: 'Bugs' }])
    hoisted.findManyPostExternalLinks.mockResolvedValue([])
  })

  it('never writes to the database', async () => {
    const csv = 'title,content\nFirst,Body\n'
    await previewImport({ ...BASE_INPUT, csvContent: csvContent(csv), totalRows: 1 })
    expect(hoisted.insert).not.toHaveBeenCalled()
  })

  it('builds counts by board/status/author and a row sample', async () => {
    const csv =
      'title,content,status,board,author_email\n' +
      'First,Body one,open,bugs,alice@example.com\n' +
      'Second,Body two,open,bugs,alice@example.com\n'

    const preview = await previewImport({
      ...BASE_INPUT,
      csvContent: csvContent(csv),
      totalRows: 2,
    })

    expect(preview.counts.byBoard).toEqual({ bugs: 2 })
    expect(preview.counts.byStatus).toEqual({ Open: 2 })
    expect(preview.counts.byAuthor).toEqual({ 'alice@example.com': 2 })
    expect(preview.sample).toHaveLength(2)
    expect(preview.sample[0]).toMatchObject({
      title: 'First',
      board: 'bugs',
      status: 'Open',
      author: 'alice@example.com',
      action: 'create',
    })
  })

  it('marks the first occurrence of a new author and reuses it for repeats', async () => {
    const csv =
      'title,content,author_email\n' +
      'First,Body one,new@example.com\n' +
      'Second,Body two,new@example.com\n'

    const preview = await previewImport({
      ...BASE_INPUT,
      csvContent: csvContent(csv),
      totalRows: 2,
    })

    expect(preview.sample[0].isNewAuthor).toBe(true)
    expect(preview.sample[1].isNewAuthor).toBe(false)
  })

  it('reports per-row validation errors without throwing', async () => {
    const csv = 'title,content\n,Body without a title\n'
    const preview = await previewImport({
      ...BASE_INPUT,
      csvContent: csvContent(csv),
      totalRows: 1,
    })

    expect(preview.errors).toHaveLength(1)
    expect(preview.errors[0].row).toBe(1)
  })

  it('reports to-be-created statuses, boards, and tags without writing them', async () => {
    const csv =
      'title,content,status,board,tags\n' +
      'First,Body one,In Progress,Feature Requests,"ui,theme"\n' +
      'Second,Body two,open,bugs,ui\n'

    const preview = await previewImport({
      ...BASE_INPUT,
      csvContent: csvContent(csv),
      totalRows: 2,
    })

    expect(preview.creates.statuses).toEqual(['In Progress'])
    expect(preview.creates.boards).toEqual(['Feature Requests'])
    expect(preview.creates.tags.sort()).toEqual(['theme', 'ui'])
    // Existing taxonomy matched by slug/name is NOT reported as new.
    expect(preview.creates.statuses).not.toContain('open')
    expect(preview.creates.boards).not.toContain('bugs')
    // The pending row shows the raw status label and the slugified board.
    expect(preview.sample[0]).toMatchObject({
      status: 'In Progress',
      board: 'feature-requests',
    })
    expect(hoisted.insert).not.toHaveBeenCalled()
  })

  it('marks a row as an update when its source_id matches a prior import link', async () => {
    hoisted.findManyPostExternalLinks.mockResolvedValue([
      { externalId: 'ext-1', postId: 'post_existing' },
    ])
    const csv = 'title,content,source_id\nExisting,Body,ext-1\n'

    const preview = await previewImport({
      ...BASE_INPUT,
      csvContent: csvContent(csv),
      totalRows: 1,
    })

    expect(preview.sample[0].action).toBe('update')
    expect(preview.updatedCount).toBe(1)
  })
})
