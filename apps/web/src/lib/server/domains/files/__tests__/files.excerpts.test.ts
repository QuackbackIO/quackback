/**
 * The one query Quinn's thread mapper uses to read a file's extracted text:
 * textExcerpt, name, family, previewStatus, for a set of file ids.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { files } from '@/lib/server/db'
import type { FileId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { loadFileExcerpts } from '../files.excerpts'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: files.id }).from(files).limit(0)
  },
})

async function insertFile(overrides: Partial<typeof files.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(files)
    .values({
      storageKey: `files/${Math.random().toString(36).slice(2)}`,
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      family: 'pdf',
      size: 100,
      sha256: 'a'.repeat(64),
      source: 'visitor',
      previewStatus: 'ready',
      ...overrides,
    })
    .returning()
  return row!
}

describe.skipIf(!fixture.available)('loadFileExcerpts (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns an empty map for no ids, without querying', async () => {
    expect(await loadFileExcerpts([])).toEqual(new Map())
  })

  it('loads textExcerpt, name, family, and previewStatus, keyed by id', async () => {
    const row = await insertFile({ textExcerpt: 'Invoice #42 for Acme Corp, total $500.' })
    const result = await loadFileExcerpts([row.id])
    expect(result.get(row.id)).toEqual({
      id: row.id,
      name: 'invoice.pdf',
      family: 'pdf',
      previewStatus: 'ready',
      textExcerpt: 'Invoice #42 for Acme Corp, total $500.',
    })
  })

  it('loads several files in one query, each by its own id', async () => {
    const a = await insertFile({ name: 'a.pdf', textExcerpt: 'alpha' })
    const b = await insertFile({ name: 'b.docx', family: 'document', textExcerpt: 'beta' })
    const result = await loadFileExcerpts([a.id, b.id])
    expect(result.size).toBe(2)
    expect(result.get(a.id)?.textExcerpt).toBe('alpha')
    expect(result.get(b.id)?.textExcerpt).toBe('beta')
  })

  it('carries a null textExcerpt through rather than omitting the row', async () => {
    const row = await insertFile({ previewStatus: 'pending', textExcerpt: null })
    const result = await loadFileExcerpts([row.id])
    expect(result.get(row.id)).toMatchObject({ textExcerpt: null, previewStatus: 'pending' })
  })

  it('excludes a soft-deleted file', async () => {
    const row = await insertFile({ textExcerpt: 'gone', deletedAt: new Date() })
    expect(await loadFileExcerpts([row.id])).toEqual(new Map())
  })

  it('omits an id that does not exist, rather than throwing', async () => {
    const row = await insertFile({ textExcerpt: 'present' })
    const result = await loadFileExcerpts([row.id, 'file_01h455vb4pex5vsknk084sn02q' as FileId])
    expect(result.size).toBe(1)
    expect(result.has(row.id)).toBe(true)
  })
})
