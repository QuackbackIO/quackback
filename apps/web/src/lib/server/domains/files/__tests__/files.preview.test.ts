// @vitest-environment node
/**
 * The `file-preview` job against a real database, with object storage and
 * the realtime fan-out recorded rather than performed.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import * as mupdf from 'mupdf'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversationMessages, conversations, eq, files, principal } from '@/lib/server/db'
import type { ConversationAttachment, FilePreviewMeta } from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import type { FileId, PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

/** Object storage: what the job may read, and what it wrote. */
const objects = new Map<string, Uint8Array>()
const uploads: Array<{ key: string; type: string; bytes: Uint8Array }> = []
const reads: Array<{ key: string; range?: string }> = []
let storageDown = false

vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  getS3Object: vi.fn(async (key: string, range?: string) => {
    reads.push({ key, range })
    if (storageDown) throw new Error('storage unreachable')
    const all = objects.get(key)
    if (!all) throw new Error(`no object ${key}`)
    let bytes = all
    let contentRange: string | undefined
    if (range) {
      const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range)!
      bytes = all.slice(Number(a), Number(b) + 1)
      contentRange = `bytes ${a}-${Number(a) + bytes.length - 1}/${all.length}`
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Several chunks, as a network body arrives.
        for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096))
        controller.close()
      },
    })
    return {
      body,
      contentType: 'application/octet-stream',
      contentLength: bytes.length,
      contentRange,
    }
  }),
  uploadObject: vi.fn(async (key: string, body: Uint8Array, type: string) => {
    uploads.push({ key, type, bytes: body })
    return `/api/storage/${key}`
  }),
  getPublicUrlOrNull: (key: string | null | undefined) =>
    key ? `/api/storage/${key}?read=s` : null,
  resignStoredAssetUrl: (src: string) => src,
}))

const published: Array<{
  channel: string
  kind: string
  message?: { id: string; attachments?: ConversationAttachment[] }
}> = []
vi.mock('@/lib/server/realtime/conversation-channels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/realtime/conversation-channels')>()),
  publishAgentConversationEvent: vi.fn((event: { kind: string; message?: never }) => {
    published.push({ channel: 'inbox', kind: event.kind, message: event.message })
  }),
  publishConversationOnlyEvent: vi.fn((_id: string, event: { kind: string; message?: never }) => {
    published.push({ channel: 'conversation', kind: event.kind, message: event.message })
  }),
  publishTicketEvent: vi.fn((_id: string, event: { kind: string; message?: never }) => {
    published.push({ channel: 'ticket', kind: event.kind, message: event.message })
  }),
}))

import { generateFilePreview } from '../files.preview'
import { runFilePreview, previewFileAndPublish } from '@/lib/server/messages/file-preview-job'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: files.id, meta: files.meta }).from(files).limit(0)
  },
})

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function textBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function pdfBytes(): Uint8Array {
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'))
  const resources = doc.addObject({ Font: { F1: font } })
  doc.insertPage(
    -1,
    doc.addPage([0, 0, 612, 792], 0, resources, 'BT /F1 18 Tf 20 700 Td (Order 5531) Tj ET')
  )
  return doc.saveToBuffer('').asUint8Array().slice()
}

/**
 * A PDF of a few hundred bytes whose first page takes seconds to render:
 * forms that draw forms, `fanout` times at each of three levels.
 */
function slowPdfBytes(fanout: number): Uint8Array {
  const doc = new mupdf.PDFDocument()
  let lines = ''
  for (let i = 0; i < fanout; i++) lines += `${i % 50} 0 m ${50 - (i % 50)} 50 l S `
  let form = doc.addStream(lines, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50] })
  for (let level = 0; level < 2; level++) {
    form = doc.addStream('/F Do '.repeat(fanout), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 50, 50],
      Resources: { XObject: { F: form } },
    })
  }
  const resources = doc.addObject({ XObject: { F: form } })
  doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, resources, '/F Do'))
  return doc.saveToBuffer('compress').asUint8Array().slice()
}

function docxBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'docProps/app.xml': strToU8('<Properties><Pages>2</Pages></Properties>'),
    'word/vbaProject.bin': new Uint8Array([1, 2, 3]),
    'word/document.xml': strToU8(
      '<w:document><w:body><w:p><w:r><w:t>Macro memo</w:t></w:r></w:p></w:body></w:document>'
    ),
  })
}

function mp4Bytes(durationMs: number): Uint8Array {
  const box = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(8 + body.length)
    new DataView(out.buffer).setUint32(0, out.length)
    out.set(textBytes(type), 4)
    out.set(body, 8)
    return out
  }
  const mvhd = new Uint8Array(100)
  new DataView(mvhd.buffer).setUint32(12, 1000)
  new DataView(mvhd.buffer).setUint32(16, durationMs)
  const parts = [
    box('ftyp', textBytes('isom\0\0\0\0isom')),
    box('mdat', new Uint8Array(200_000)),
    box('moov', box('mvhd', mvhd)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

let keySeq = 0
async function storedFile(input: {
  name: string
  contentType: string
  family: string
  bytes: Uint8Array
  meta?: FilePreviewMeta
  previewStatus?: string
}) {
  const storageKey = `files/2026/10/${++keySeq}-${input.name}`
  objects.set(storageKey, input.bytes)
  const [row] = await testDb
    .insert(files)
    .values({
      storageKey,
      name: input.name,
      contentType: input.contentType,
      family: input.family,
      size: input.bytes.byteLength,
      sha256: 'x'.repeat(64),
      source: 'agent',
      meta: input.meta ?? {},
      ...(input.previewStatus ? { previewStatus: input.previewStatus } : {}),
    })
    .returning()
  return row!
}

async function reload(id: FileId) {
  const [row] = await testDb.select().from(files).where(eq(files.id, id))
  return row!
}

function job(fileId: string, attempts = 1, maxAttempts = 2): ClaimedJob {
  return {
    id: '1',
    jobId: 'job_1',
    queue: 'file-preview',
    dedupeKey: fileId,
    payload: { fileId },
    workspaceKey: null,
    attempts,
    maxAttempts,
  } as unknown as ClaimedJob
}

async function newPrincipal(): Promise<PrincipalId> {
  const [p] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  return p!.id
}

function attachmentFor(row: { id: string; name: string; contentType: string; size: number }) {
  return {
    url: '/api/storage/x',
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    fileId: row.id,
    family: 'text' as const,
  }
}

describe.skipIf(!fixture.available)('file-preview job (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    objects.clear()
    uploads.length = 0
    reads.length = 0
    published.length = 0
    storageDown = false
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('writes the counts, first lines and excerpt of a text file', async () => {
    const row = await storedFile({
      name: 'server.log',
      contentType: 'text/plain',
      family: 'text',
      bytes: textBytes('boot ok\nlisten   :8080\nready\n'),
    })
    await runFilePreview(job(row.id))
    const after = await reload(row.id)
    expect(after.previewStatus).toBe('ready')
    expect(after.meta).toEqual({ lines: 3, text: 'boot ok\nlisten   :8080\nready' })
    expect(after.textExcerpt).toBe('boot ok\nlisten :8080\nready')
  })

  it('renders a PDF thumbnail next to the original and records its key', async () => {
    const row = await storedFile({
      name: 'order.pdf',
      contentType: 'application/pdf',
      family: 'pdf',
      bytes: pdfBytes(),
    })
    expect(await generateFilePreview(row.id)).toBe('ready')
    const after = await reload(row.id)
    expect(after.meta).toEqual({ pages: 1, thumbKey: `${row.storageKey}.thumb.png` })
    expect(after.textExcerpt).toContain('Order 5531')
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({ key: `${row.storageKey}.thumb.png`, type: 'image/png' })
    expect(Array.from(uploads[0]!.bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('keeps the macro flag the upload recorded', async () => {
    const row = await storedFile({
      name: 'memo.docm',
      contentType: 'application/vnd.ms-word.document.macroEnabled.12',
      family: 'document',
      bytes: docxBytes(),
      meta: { macro: true },
    })
    await generateFilePreview(row.id)
    const after = await reload(row.id)
    expect(after.meta).toEqual({ macro: true, pages: 2 })
    expect(after.textExcerpt).toBe('Macro memo')
  })

  it('reads the duration of a video through ranged reads', async () => {
    const row = await storedFile({
      name: 'clip.mp4',
      contentType: 'video/mp4',
      family: 'video',
      bytes: mp4Bytes(42_000),
    })
    expect(await generateFilePreview(row.id)).toBe('ready')
    expect((await reload(row.id)).meta).toEqual({ durationMs: 42_000 })
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((r) => r.range !== undefined)).toBe(true)
  })

  it('records none without reading a format with nothing to derive', async () => {
    const row = await storedFile({
      name: 'logo.svg',
      contentType: 'image/svg+xml',
      family: 'image',
      bytes: textBytes('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    })
    expect(await generateFilePreview(row.id)).toBe('none')
    expect((await reload(row.id)).previewStatus).toBe('none')
    expect(reads).toHaveLength(0)
  })

  it('marks a corrupt file failed without throwing', async () => {
    const row = await storedFile({
      name: 'broken.docx',
      contentType: DOCX,
      family: 'document',
      bytes: textBytes('PK\u0003\u0004 this is not a real package'),
      meta: { macro: true },
    })
    await expect(runFilePreview(job(row.id))).resolves.toBeUndefined()
    const after = await reload(row.id)
    expect(after.previewStatus).toBe('failed')
    expect(after.meta).toEqual({ macro: true })
    expect(uploads).toHaveLength(0)
  })

  it('marks a file that runs past the time budget failed', async () => {
    const row = await storedFile({
      name: 'slow.pdf',
      contentType: 'application/pdf',
      family: 'pdf',
      bytes: pdfBytes(),
    })
    // A budget already spent: the first check between phases refuses.
    expect(await generateFilePreview(row.id, { budgetMs: -1 })).toBe('failed')
    expect((await reload(row.id)).previewStatus).toBe('failed')
    expect(uploads).toHaveLength(0)
  })

  it('stops a parser mid-render at the time budget, and the server keeps answering', async () => {
    // About 420,000 strokes: several seconds of one uninterruptible render.
    const row = await storedFile({
      name: 'slow.pdf',
      contentType: 'application/pdf',
      family: 'pdf',
      bytes: slowPdfBytes(75),
    })
    let ticks = 0
    const ticker = setInterval(() => ticks++, 50)
    const started = Date.now()
    try {
      expect(await generateFilePreview(row.id, { budgetMs: 1_500 })).toBe('failed')
    } finally {
      clearInterval(ticker)
    }
    const took = Date.now() - started
    expect(took).toBeLessThan(4_000)
    // The render ran off this thread: timers here kept firing throughout.
    expect(ticks).toBeGreaterThan((took / 50) * 0.5)
    expect((await reload(row.id)).previewStatus).toBe('failed')
    expect(uploads).toHaveLength(0)
  })

  it('skips a missing, deleted or already previewed file', async () => {
    await expect(runFilePreview(job('file_01k00000000000000000000000'))).resolves.toBeUndefined()
    const deleted = await storedFile({
      name: 'a.txt',
      contentType: 'text/plain',
      family: 'text',
      bytes: textBytes('a'),
    })
    await testDb.update(files).set({ deletedAt: new Date() }).where(eq(files.id, deleted.id))
    const ready = await storedFile({
      name: 'b.txt',
      contentType: 'text/plain',
      family: 'text',
      bytes: textBytes('b'),
      previewStatus: 'ready',
      meta: { lines: 9 },
    })
    expect(await generateFilePreview(deleted.id)).toBe('skipped')
    expect(await generateFilePreview(ready.id)).toBe('skipped')
    expect(reads).toHaveLength(0)
    expect((await reload(deleted.id)).previewStatus).toBe('pending')
    expect((await reload(ready.id)).meta).toEqual({ lines: 9 })
  })

  it('throws on a storage fault so the queue retries, and gives up on the last attempt', async () => {
    const row = await storedFile({
      name: 'c.txt',
      contentType: 'text/plain',
      family: 'text',
      bytes: textBytes('c'),
    })
    storageDown = true
    await expect(runFilePreview(job(row.id, 1, 2))).rejects.toThrow()
    expect((await reload(row.id)).previewStatus).toBe('pending')
    await expect(runFilePreview(job(row.id, 2, 2))).rejects.toThrow()
    expect((await reload(row.id)).previewStatus).toBe('failed')
  })

  it('copies the preview onto the first message only, for the matching file only', async () => {
    const visitor = await newPrincipal()
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: visitor, channel: 'messenger' })
      .returning()
    const row = await storedFile({
      name: 'notes.txt',
      contentType: 'text/plain',
      family: 'text',
      bytes: textBytes('first line\nsecond line\n'),
    })
    const other = await storedFile({
      name: 'other.txt',
      contentType: 'text/plain',
      family: 'text',
      bytes: textBytes('other'),
    })
    const insertMessage = async (attachments: ConversationAttachment[]) =>
      (
        await testDb
          .insert(conversationMessages)
          .values({
            conversationId: conversation!.id,
            principalId: visitor,
            senderType: 'visitor',
            content: '',
            attachments,
          })
          .returning()
      )[0]!
    const first = await insertMessage([attachmentFor(row), attachmentFor(other)])
    const copy = await insertMessage([attachmentFor(row)])
    await testDb
      .update(files)
      .set({ messageId: first.id, attachedAt: new Date() })
      .where(eq(files.id, row.id))

    await previewFileAndPublish(row.id)

    const [firstAfter] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.id, first.id))
    const [copyAfter] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.id, copy.id))
    expect(firstAfter!.attachments![0]).toEqual({
      ...attachmentFor(row),
      family: 'text',
      preview: { lines: 2, text: 'first line\nsecond line' },
    })
    expect(firstAfter!.attachments![1]).toEqual(attachmentFor(other))
    expect(copyAfter!.attachments).toEqual([attachmentFor(row)])

    // Open threads hear about it: agents on the inbox, the visitor on theirs.
    const inbox = published.find((p) => p.channel === 'inbox' && p.kind === 'message_updated')
    expect(inbox?.message?.id).toBe(first.id)
    expect(inbox?.message?.attachments?.[0]?.preview).toMatchObject({ lines: 2 })
    const visitorEvent = published.find((p) => p.channel === 'conversation')
    expect(visitorEvent).toMatchObject({ kind: 'message_edited' })
    expect(visitorEvent?.message?.id).toBe(first.id)
  })

  it('does not publish when the file is not attached yet', async () => {
    const row = await storedFile({
      name: 'd.txt',
      contentType: 'text/plain',
      family: 'text',
      bytes: textBytes('d'),
    })
    await previewFileAndPublish(row.id)
    expect(published).toHaveLength(0)
  })
})
