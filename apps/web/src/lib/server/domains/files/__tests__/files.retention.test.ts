/**
 * Real-DB coverage for the file retention sweep: which files it removes,
 * which it must leave alone, and what a storage failure does. Storage is the
 * only double; it records every key it is asked to delete.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversationMessages, conversations, eq, files, principal } from '@/lib/server/db'
import type { ConversationAttachment, FilePreviewMeta } from '@/lib/server/db'
import type { FileId, PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const deleted: string[] = []
const attempted: string[] = []
const failingKeys = new Set<string>()
/** Runs once, during the next object delete: what happens while the sweep is mid-batch. */
let duringNextDelete: (() => Promise<void>) | null = null
vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  deleteObject: vi.fn(async (key: string) => {
    attempted.push(key)
    const hook = duringNextDelete
    duringNextDelete = null
    await hook?.()
    if (failingKeys.has(key)) throw new Error(`storage unavailable for ${key}`)
    deleted.push(key)
  }),
}))

import { sweepFileRetention, runFileRetention, UNSENT_FILE_GRACE_MS } from '../files.retention'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: files.id }).from(files).limit(0)
  },
})

const HOUR = 3_600_000
const NOW = new Date('2026-10-01T04:40:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

let seq = 0
async function insertFile(
  overrides: Partial<typeof files.$inferInsert> & { meta?: FilePreviewMeta } = {}
) {
  seq += 1
  const [row] = await testDb
    .insert(files)
    .values({
      storageKey: `files/2026/09/0000000${seq}-0000-4000-8000-000000000000-f${seq}.pdf`,
      name: `f${seq}.pdf`,
      contentType: 'application/pdf',
      family: 'pdf',
      size: 10,
      sha256: 'a'.repeat(64),
      source: 'agent',
      createdAt: ago(48 * HOUR),
      ...overrides,
    })
    .returning()
  return row!
}

async function fileRow(id: FileId) {
  const [row] = await testDb.select().from(files).where(eq(files.id, id))
  return row!
}

async function newConversation() {
  const [p] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: p!.id as PrincipalId, channel: 'messenger' })
    .returning()
  return { conversationId: conversation!.id, principalId: p!.id as PrincipalId }
}

async function insertMessage(attachments: ConversationAttachment[] | null) {
  const { conversationId, principalId } = await newConversation()
  const [m] = await testDb
    .insert(conversationMessages)
    .values({ conversationId, principalId, senderType: 'visitor', content: 'hi', attachments })
    .returning()
  return m!
}

const attachmentFor = (id: FileId): ConversationAttachment => ({
  url: '/api/storage/files/x.pdf',
  name: 'x.pdf',
  contentType: 'application/pdf',
  size: 10,
  fileId: id,
  family: 'pdf',
})

describe.skipIf(!fixture.available)('file retention sweep (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    deleted.length = 0
    attempted.length = 0
    failingKeys.clear()
    duringNextDelete = null
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('files never sent', () => {
    it('deletes the object, its thumbnail and rendition, then marks the row', async () => {
      const row = await insertFile({
        meta: {
          pages: 3,
          text: 'first lines',
          thumbKey: 'files/2026/09/thumb-1.webp',
          renditionKey: 'files/2026/09/rend-1.jpg',
        },
        textExcerpt: 'secret contents',
      })

      const result = await sweepFileRetention({ now: NOW })

      expect(deleted.sort()).toEqual(
        [row.storageKey, 'files/2026/09/thumb-1.webp', 'files/2026/09/rend-1.jpg'].sort()
      )
      const after = await fileRow(row.id)
      expect(after.deletedAt).toEqual(NOW)
      expect(after.meta).toEqual({})
      expect(after.textExcerpt).toBeNull()
      expect(result).toMatchObject({ removed: 1, failed: 0 })
    })

    it('keeps a file uploaded within the last 24 hours', async () => {
      const recent = await insertFile({ createdAt: ago(60_000) })
      const almost = await insertFile({ createdAt: ago(UNSENT_FILE_GRACE_MS - 1) })
      const exactly = await insertFile({ createdAt: ago(UNSENT_FILE_GRACE_MS) })
      const past = await insertFile({ createdAt: ago(UNSENT_FILE_GRACE_MS + 1) })

      await sweepFileRetention({ now: NOW })

      expect((await fileRow(recent.id)).deletedAt).toBeNull()
      expect((await fileRow(almost.id)).deletedAt).toBeNull()
      expect((await fileRow(exactly.id)).deletedAt).toBeNull()
      expect((await fileRow(past.id)).deletedAt).toEqual(NOW)
      expect(deleted).toEqual([past.storageKey])
      expect(UNSENT_FILE_GRACE_MS).toBe(24 * HOUR)
    })

    it('leaves a sent file alone however old it is', async () => {
      const message = await insertMessage(null)
      const row = await insertFile({
        createdAt: ago(400 * 24 * HOUR),
        messageId: message.id,
        attachedAt: ago(400 * 24 * HOUR),
      })

      await sweepFileRetention({ now: NOW })

      expect((await fileRow(row.id)).deletedAt).toBeNull()
      expect(deleted).toEqual([])
    })
  })

  describe('files whose first message was deleted', () => {
    it('removes one no remaining message references', async () => {
      const row = await insertFile({ attachedAt: ago(10 * 24 * HOUR), messageId: null })

      const result = await sweepFileRetention({ now: NOW })

      expect(deleted).toEqual([row.storageKey])
      expect((await fileRow(row.id)).deletedAt).toEqual(NOW)
      expect(result).toMatchObject({ removed: 1, kept: 0 })
    })

    it('keeps one a later message still carries (a ticket copy)', async () => {
      const copied = await insertFile({ attachedAt: ago(10 * 24 * HOUR), messageId: null })
      const orphan = await insertFile({ attachedAt: ago(10 * 24 * HOUR), messageId: null })
      // The later message carries the copied file alongside its own.
      const own = await insertFile({ attachedAt: ago(HOUR) })
      const later = await insertMessage([attachmentFor(own.id), attachmentFor(copied.id)])
      await testDb.update(files).set({ messageId: later.id }).where(eq(files.id, own.id))

      const result = await sweepFileRetention({ now: NOW })

      expect((await fileRow(copied.id)).deletedAt).toBeNull()
      expect((await fileRow(orphan.id)).deletedAt).toEqual(NOW)
      expect(deleted).toEqual([orphan.storageKey])
      expect(result).toMatchObject({ removed: 1, kept: 1 })
    })

    it('is not fooled by a message that only names the file in its text', async () => {
      const row = await insertFile({ attachedAt: ago(HOUR), messageId: null })
      const { conversationId, principalId } = await newConversation()
      await testDb.insert(conversationMessages).values({
        conversationId,
        principalId,
        senderType: 'visitor',
        content: `see ${row.id}`,
        attachments: [],
      })

      await sweepFileRetention({ now: NOW })

      expect((await fileRow(row.id)).deletedAt).toEqual(NOW)
    })
  })

  describe('safety', () => {
    it('never touches an object outside the files/ prefix', async () => {
      const foreign = await insertFile({ storageKey: 'chat-images/2026/09/old.png' })
      const mixed = await insertFile({ meta: { thumbKey: 'avatars/someone.png' } })

      await sweepFileRetention({ now: NOW })

      expect((await fileRow(foreign.id)).deletedAt).toBeNull()
      expect(deleted).toEqual([mixed.storageKey])
      expect(deleted).not.toContain('avatars/someone.png')
      expect(deleted).not.toContain('chat-images/2026/09/old.png')
    })

    it('leaves the row for the next run when a storage delete fails', async () => {
      const broken = await insertFile({ meta: { thumbKey: 'files/2026/09/thumb-broken.webp' } })
      const fine = await insertFile()
      failingKeys.add('files/2026/09/thumb-broken.webp')

      const first = await sweepFileRetention({ now: NOW })

      expect(first).toMatchObject({ removed: 1, failed: 1 })
      // The claim is released, so the file is usable and the next run retries it.
      const kept = await fileRow(broken.id)
      expect(kept.deletedAt).toBeNull()
      expect(kept.meta).toEqual({ thumbKey: 'files/2026/09/thumb-broken.webp' })
      expect((await fileRow(fine.id)).deletedAt).toEqual(NOW)

      failingKeys.clear()
      deleted.length = 0
      const second = await sweepFileRetention({ now: NOW })
      expect(second).toMatchObject({ removed: 1, failed: 0 })
      expect((await fileRow(broken.id)).deletedAt).toEqual(NOW)
      expect(deleted).toContain('files/2026/09/thumb-broken.webp')
    })

    it('is idempotent', async () => {
      await insertFile()
      await insertFile({ attachedAt: ago(HOUR), messageId: null })

      const first = await sweepFileRetention({ now: NOW })
      const calls = deleted.length
      const second = await sweepFileRetention({ now: NOW })

      expect(first.removed).toBe(2)
      expect(second).toMatchObject({ removed: 0, failed: 0, kept: 0 })
      expect(deleted.length).toBe(calls)
    })

    it('works through more files than one batch, past ones that fail', async () => {
      const rows: Array<typeof files.$inferSelect> = []
      for (let i = 0; i < 5; i++) rows.push(await insertFile())
      failingKeys.add(rows[1]!.storageKey)
      failingKeys.add(rows[3]!.storageKey)

      const result = await sweepFileRetention({ now: NOW, batchSize: 2 })

      expect(result).toMatchObject({ removed: 3, failed: 2 })
      // Each failing object was tried once, not once per batch.
      expect(deleted).toHaveLength(3)
      expect(attempted.filter((k) => k === rows[1]!.storageKey)).toHaveLength(1)
      expect(attempted.filter((k) => k === rows[3]!.storageKey)).toHaveLength(1)
      expect(attempted).toHaveLength(5)
    })
  })

  describe('races with a send', () => {
    it('leaves an unsent file alone when a send links it after the sweep listed it', async () => {
      const first = await insertFile()
      const second = await insertFile()
      const message = await insertMessage([attachmentFor(second.id)])
      // The sweep listed both; while it deletes the first, a send links the second.
      duringNextDelete = async () => {
        await testDb
          .update(files)
          .set({ messageId: message.id, attachedAt: NOW })
          .where(eq(files.id, second.id))
      }

      await sweepFileRetention({ now: NOW })

      expect(deleted).toEqual([first.storageKey])
      expect((await fileRow(first.id)).deletedAt).toEqual(NOW)
      const linked = await fileRow(second.id)
      expect(linked.deletedAt).toBeNull()
      expect(linked.messageId).toBe(message.id)
    })

    it('keeps an orphaned file a message starts carrying after the sweep listed it', async () => {
      const first = await insertFile({ attachedAt: ago(HOUR), messageId: null })
      const second = await insertFile({ attachedAt: ago(HOUR), messageId: null })
      // While the sweep deletes the first, a ticket copies the second.
      duringNextDelete = async () => {
        await insertMessage([attachmentFor(second.id)])
      }

      const result = await sweepFileRetention({ now: NOW })

      expect(deleted).toEqual([first.storageKey])
      expect((await fileRow(second.id)).deletedAt).toBeNull()
      expect(result).toMatchObject({ removed: 1, kept: 1 })
    })

    it('holds a file as deleted while its objects are being removed', async () => {
      const row = await insertFile()
      let seen: Date | null = null
      duringNextDelete = async () => {
        seen = (await fileRow(row.id)).deletedAt
      }

      await sweepFileRetention({ now: NOW })

      // A send that reads the row mid-delete is told the file is gone.
      expect(seen).toEqual(NOW)
    })
  })

  describe('the job handler', () => {
    it('runs the sweep', async () => {
      const row = await insertFile({ createdAt: new Date(Date.now() - 48 * HOUR) })
      await runFileRetention({ payload: {} } as unknown as ClaimedJob)
      expect((await fileRow(row.id)).deletedAt).not.toBeNull()
      expect(deleted).toEqual([row.storageKey])
    })
  })
})
