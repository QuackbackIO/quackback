/**
 * Real-DB coverage for the file pipeline's trust boundary: what `storeFile`
 * refuses and records, and how `resolveAttachments` turns a sender's
 * attachment list into what a message stores.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversationMessages, conversations, eq, files, principal } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const uploaded: Array<{ key: string; type: string; size: number }> = []
vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  uploadObject: vi.fn(async (key: string, body: Uint8Array, type: string) => {
    uploaded.push({ key, type, size: body.byteLength })
    return `/api/storage/${key}?read=sig`
  }),
  getPublicUrlOrNull: (key: string | null | undefined) =>
    key ? `/api/storage/${key}?read=fresh` : null,
}))

vi.mock('@/lib/server/storage/trusted-url', () => ({
  isTrustedAttachmentUrl: (url: string) =>
    typeof url === 'string' && url.startsWith('/api/storage/'),
}))

const enqueued: Array<{ queue: string; payload: unknown; dedupeKey?: string }> = []
vi.mock('@/lib/server/jobs/job-queue', () => ({
  enqueueJob: vi.fn(async (input: { queue: string; payload: unknown; dedupeKey?: string }) => {
    enqueued.push(input)
    return { inserted: true, jobId: 'job_x' }
  }),
}))

import {
  storeFile,
  resolveAttachments,
  linkFilesToMessage,
  recordFileOpen,
  cleanFileName,
  FileRejectedError,
} from '../files.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: files.id }).from(files).limit(0)
  },
})

const pdf = () => new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(200))
const exe = () => new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4])

async function newPrincipal(): Promise<PrincipalId> {
  const [p] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  return p!.id
}

describe('cleanFileName', () => {
  it('keeps only the base name, without control characters', () => {
    expect(cleanFileName('C:\\Users\\a\\report.pdf')).toBe('report.pdf')
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanFileName('a\u0000b\u001f.txt')).toBe('ab.txt')
  })
  it('falls back to a placeholder and caps length, keeping the extension', () => {
    expect(cleanFileName('')).toBe('file')
    expect(cleanFileName('..')).toBe('file')
    const long = cleanFileName('x'.repeat(400) + '.xlsx')
    expect(long.length).toBe(255)
    expect(long.endsWith('.xlsx')).toBe(true)
  })
})

describe.skipIf(!fixture.available)('files service (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    uploaded.length = 0
    enqueued.length = 0
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('storeFile', () => {
    it('stores the sniffed type, not the declared one, and queues a preview', async () => {
      const row = await storeFile({
        bytes: pdf(),
        name: 'invoice.png',
        declaredType: 'image/png',
        source: 'visitor',
        unverifiedSender: true,
      })
      expect(row).toMatchObject({
        contentType: 'application/pdf',
        family: 'pdf',
        declaredType: 'image/png',
        source: 'visitor',
        size: pdf().byteLength,
      })
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(uploaded).toEqual([{ key: row.storageKey, type: 'application/pdf', size: row.size }])
      expect(row.storageKey.startsWith('files/')).toBe(true)
      expect(enqueued).toEqual([
        expect.objectContaining({
          queue: 'file-preview',
          dedupeKey: row.id,
          payload: { fileId: row.id },
        }),
      ])
    })

    it('refuses executables from unverified senders, by bytes and by name', async () => {
      await expect(
        storeFile({ bytes: exe(), name: 'invoice.pdf', source: 'email', unverifiedSender: true })
      ).rejects.toMatchObject({ reason: 'blocked' })
      await expect(
        storeFile({
          bytes: new TextEncoder().encode('alert(1)'),
          name: 'helper.js',
          source: 'visitor',
          unverifiedSender: true,
        })
      ).rejects.toBeInstanceOf(FileRejectedError)
      expect(uploaded).toHaveLength(0)
      expect(await testDb.select().from(files)).toHaveLength(0)
    })

    it('lets a verified sender send an executable', async () => {
      const row = await storeFile({
        bytes: exe(),
        name: 'tool.exe',
        source: 'agent',
        unverifiedSender: false,
      })
      expect(row.family).toBe('other')
    })

    it('caps size by the sniffed family', async () => {
      const big = new Uint8Array(25 * 1024 * 1024 + 1)
      big.set(new TextEncoder().encode('%PDF-1.7'))
      await expect(
        storeFile({ bytes: big, name: 'big.pdf', source: 'agent', unverifiedSender: false })
      ).rejects.toMatchObject({ reason: 'too_large' })
      // The same size is fine for video.
      const video = new Uint8Array(25 * 1024 * 1024 + 1)
      video.set([0, 0, 0, 24, ...new TextEncoder().encode('ftypisom')])
      const row = await storeFile({
        bytes: video,
        name: 'rec.mp4',
        source: 'agent',
        unverifiedSender: false,
      })
      expect(row.family).toBe('video')
    })

    it('refuses an empty file', async () => {
      await expect(
        storeFile({
          bytes: new Uint8Array(0),
          name: 'a.txt',
          source: 'agent',
          unverifiedSender: false,
        })
      ).rejects.toMatchObject({ reason: 'empty' })
    })
  })

  describe('resolveAttachments', () => {
    it('rebuilds a file attachment from its row, ignoring what the request claimed', async () => {
      const owner = await newPrincipal()
      const row = await storeFile({
        bytes: pdf(),
        name: 'a.pdf',
        source: 'visitor',
        uploadedById: owner,
        unverifiedSender: true,
      })
      const [att] = await resolveAttachments(
        [
          {
            fileId: row.id,
            url: 'https://evil.example/x',
            name: 'b.exe',
            contentType: 'text/html',
            size: 1,
          },
        ],
        { principalId: owner, canAttachAnyFile: false }
      )
      expect(att).toEqual({
        url: `/api/storage/${row.storageKey}?read=fresh`,
        name: 'a.pdf',
        contentType: 'application/pdf',
        size: row.size,
        fileId: row.id,
        family: 'pdf',
      })
    })

    it("refuses a visitor attaching someone else's file, but lets a team member", async () => {
      const owner = await newPrincipal()
      const other = await newPrincipal()
      const row = await storeFile({
        bytes: pdf(),
        name: 'a.pdf',
        source: 'visitor',
        uploadedById: owner,
        unverifiedSender: true,
      })
      const ref = [{ fileId: row.id, url: '', name: '', contentType: '', size: 0 }]
      await expect(
        resolveAttachments(ref, { principalId: other, canAttachAnyFile: false })
      ).rejects.toThrow('Invalid attachment')
      await expect(
        resolveAttachments(ref, { principalId: null, canAttachAnyFile: false })
      ).rejects.toThrow('Invalid attachment')
      await expect(
        resolveAttachments(ref, { principalId: other, canAttachAnyFile: true })
      ).resolves.toHaveLength(1)
    })

    it('refuses an unknown or deleted file id', async () => {
      const row = await storeFile({
        bytes: pdf(),
        name: 'a.pdf',
        source: 'agent',
        unverifiedSender: false,
      })
      await testDb.update(files).set({ deletedAt: new Date() }).where(eq(files.id, row.id))
      const ref = [{ fileId: row.id, url: '', name: '', contentType: '', size: 0 }]
      await expect(resolveAttachments(ref, { canAttachAnyFile: true })).rejects.toThrow(
        'Invalid attachment'
      )
      const unknown = [
        { fileId: 'file_01h455vb4pex5vsknk084sn02q', url: '', name: '', contentType: '', size: 0 },
      ]
      await expect(resolveAttachments(unknown, { canAttachAnyFile: true })).rejects.toThrow(
        'Invalid attachment'
      )
    })

    it('keeps the legacy rules for attachments without a file id', async () => {
      const ok = {
        url: '/api/storage/chat-images/a.png?read=x',
        name: 'a.png',
        contentType: 'image/png',
        size: 10,
      }
      await expect(resolveAttachments([ok], { canAttachAnyFile: false })).resolves.toEqual([ok])
      await expect(
        resolveAttachments([{ ...ok, url: 'https://evil.example/a.png' }], {
          canAttachAnyFile: false,
        })
      ).rejects.toThrow('Invalid attachment')
      await expect(
        resolveAttachments([{ ...ok, size: 26 * 1024 * 1024 }], { canAttachAnyFile: false })
      ).rejects.toThrow('Attachment too large')
    })

    it('refuses a malformed file id without querying for it', async () => {
      const ref = [{ fileId: "x' OR 1=1", url: '', name: '', contentType: '', size: 0 }]
      await expect(resolveAttachments(ref, { canAttachAnyFile: true })).rejects.toThrow(
        'Invalid attachment'
      )
    })

    it('caps the number of attachments', async () => {
      const ok = {
        url: '/api/storage/chat-images/a.png',
        name: 'a.png',
        contentType: 'image/png',
        size: 1,
      }
      await expect(
        resolveAttachments(Array(11).fill(ok), { canAttachAnyFile: true })
      ).rejects.toThrow('Too many attachments')
    })
  })

  describe('recordFileOpen', () => {
    it('counts each open', async () => {
      const row = await storeFile({
        bytes: pdf(),
        name: 'a.pdf',
        source: 'agent',
        unverifiedSender: false,
      })
      await recordFileOpen(row.id)
      await recordFileOpen(row.id)
      const [after] = await testDb.select().from(files).where(eq(files.id, row.id))
      expect(after!.openCount).toBe(2)
    })
  })

  describe('linkFilesToMessage', () => {
    it('records the first message a file was sent on and keeps it', async () => {
      const visitor = await newPrincipal()
      const [conversation] = await testDb
        .insert(conversations)
        .values({ visitorPrincipalId: visitor, channel: 'messenger' })
        .returning()
      const insertMessage = async () =>
        (
          await testDb
            .insert(conversationMessages)
            .values({
              conversationId: conversation!.id,
              principalId: visitor,
              senderType: 'visitor',
              content: 'hi',
            })
            .returning()
        )[0]!
      const first = await insertMessage()
      const second = await insertMessage()
      const row = await storeFile({
        bytes: pdf(),
        name: 'a.pdf',
        source: 'agent',
        unverifiedSender: false,
      })
      const atts = await resolveAttachments(
        [{ fileId: row.id, url: '', name: '', contentType: '', size: 0 }],
        {
          canAttachAnyFile: true,
        }
      )

      await linkFilesToMessage(testDb, atts, first.id)
      await linkFilesToMessage(testDb, atts, second.id)

      const [after] = await testDb.select().from(files).where(eq(files.id, row.id))
      expect(after!.messageId).toBe(first.id)
      expect(after!.attachedAt).toBeInstanceOf(Date)
    })
  })
})
