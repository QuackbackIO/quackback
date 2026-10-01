/**
 * Splits a message's stored attachments into real MIME parts (for a file
 * whose stored type is on the outbound allowlist, from a sender the caller
 * vouches for, within the per-email byte budget) and links for everything
 * else — a risky type, an untrusted sender, too large, foreign (no storage
 * key of ours to load), or whose bytes failed to load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationAttachment } from '@/lib/server/db'
import { MAX_EMAIL_ATTACHMENT_BYTES } from '@quackback/email'

const getS3Object = vi.fn<(key: string) => Promise<unknown>>()
const getEmailSafeUrl = vi.fn<(key: string | null | undefined) => string | null>()

vi.mock('@/lib/server/storage/s3', () => ({
  getS3Object: (...a: [string]) => getS3Object(...a),
  getEmailSafeUrl: (...a: [string | null | undefined]) => getEmailSafeUrl(...a),
}))

import {
  resolveEmailAttachments,
  appendLinkedAttachmentsHtml,
} from '../conversation.email-attachments'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let sent = false
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        controller.enqueue(bytes)
        sent = true
      } else {
        controller.close()
      }
    },
  })
}

function attachment(overrides: Partial<ConversationAttachment> = {}): ConversationAttachment {
  return {
    url: '/api/storage/files/a.pdf?read=sig',
    name: 'a.pdf',
    contentType: 'application/pdf',
    size: 100,
    ...overrides,
  }
}

beforeEach(() => {
  getS3Object.mockReset()
  getEmailSafeUrl.mockReset()
  getEmailSafeUrl.mockImplementation((key) => (key ? `https://cdn.test/${key}?email=1` : null))
})

describe('resolveEmailAttachments', () => {
  it('returns empty results for no attachments', async () => {
    expect(await resolveEmailAttachments(null)).toEqual({ attachments: [], linked: [] })
    expect(await resolveEmailAttachments([])).toEqual({ attachments: [], linked: [] })
    expect(getS3Object).not.toHaveBeenCalled()
  })

  it('links a foreign attachment with no storage key of ours, using its own url', async () => {
    const result = await resolveEmailAttachments([
      attachment({ url: 'https://cdn.example.com/legacy.png', name: 'legacy.png' }),
    ])

    expect(getS3Object).not.toHaveBeenCalled()
    expect(result.attachments).toEqual([])
    expect(result.linked).toEqual([
      { name: 'legacy.png', url: 'https://cdn.example.com/legacy.png' },
    ])
  })

  it('links a file whose bytes fail to load instead of dropping it', async () => {
    getS3Object.mockRejectedValue(new Error('object not found'))

    const result = await resolveEmailAttachments([attachment()])

    expect(result.attachments).toEqual([])
    expect(result.linked).toEqual([{ name: 'a.pdf', url: 'https://cdn.test/files/a.pdf?email=1' }])
  })

  it('drops a linked entry rather than emitting a broken url when none can be built', async () => {
    getEmailSafeUrl.mockReturnValue(null)
    getS3Object.mockRejectedValue(new Error('object not found'))

    const result = await resolveEmailAttachments([attachment()])

    expect(result.attachments).toEqual([])
    expect(result.linked).toEqual([])
  })

  // Only an allowlisted stored type is ever carried as a real MIME part —
  // everything else links, including every type an outbound provider is
  // known to refuse a whole message over.
  describe('type allowlist', () => {
    it('attaches a fileId PDF that fits the budget', async () => {
      const bytes = new TextEncoder().encode('%PDF-1.4')
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'application/pdf' })

      const result = await resolveEmailAttachments([
        attachment({ fileId: 'file_1', size: bytes.byteLength }),
      ])

      expect(result.attachments).toEqual([
        { filename: 'a.pdf', contentType: 'application/pdf', content: bytes },
      ])
      expect(result.linked).toEqual([])
    })

    it('attaches a raster image (png)', async () => {
      const bytes = new TextEncoder().encode('fake-png-bytes')
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'image/png' })

      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'shot.png',
          contentType: 'image/png',
          family: 'image',
          size: bytes.byteLength,
        }),
      ])

      expect(result.attachments).toEqual([
        { filename: 'shot.png', contentType: 'image/png', content: bytes },
      ])
    })

    it('attaches plain text and csv', async () => {
      const bytes = new TextEncoder().encode('a,b,c')
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'text/csv' })

      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'data.csv',
          contentType: 'text/csv',
          family: 'csv',
          size: bytes.byteLength,
        }),
      ])

      expect(result.attachments).toEqual([
        { filename: 'data.csv', contentType: 'text/csv', content: bytes },
      ])
    })

    it('attaches a macro-free Office document (docx)', async () => {
      const bytes = new TextEncoder().encode('fake-docx-bytes')
      const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: docxMime })

      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'report.docx',
          contentType: docxMime,
          family: 'document',
          size: bytes.byteLength,
        }),
      ])

      expect(result.attachments).toEqual([
        { filename: 'report.docx', contentType: docxMime, content: bytes },
      ])
    })

    it('links an SVG rather than attaching it, despite being family "image"', async () => {
      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'diagram.svg',
          url: '/api/storage/files/diagram.svg?read=sig',
          contentType: 'image/svg+xml',
          family: 'image',
          size: 50,
        }),
      ])

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.attachments).toEqual([])
      expect(result.linked).toEqual([
        { name: 'diagram.svg', url: 'https://cdn.test/files/diagram.svg?email=1' },
      ])
    })

    it('links a macro-enabled workbook (xlsm) even though it is an Office document', async () => {
      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'budget.xlsm',
          url: '/api/storage/files/budget.xlsm?read=sig',
          contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
          family: 'spreadsheet',
          size: 50,
        }),
      ])

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.attachments).toEqual([])
      expect(result.linked).toEqual([
        { name: 'budget.xlsm', url: 'https://cdn.test/files/budget.xlsm?email=1' },
      ])
    })

    it('links a docx whose preview carries the macro flag, even though its type is macro-free', async () => {
      const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'report.docx',
          url: '/api/storage/files/report.docx?read=sig',
          contentType: docxMime,
          family: 'document',
          size: 50,
          preview: { macro: true },
        }),
      ])

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.linked).toEqual([
        { name: 'report.docx', url: 'https://cdn.test/files/report.docx?email=1' },
      ])
    })

    it('links a legacy binary Office file (.doc) because it is not OOXML', async () => {
      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'old.doc',
          url: '/api/storage/files/old.doc?read=sig',
          contentType: 'application/msword',
          family: 'document',
          size: 50,
        }),
      ])

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.linked).toEqual([
        { name: 'old.doc', url: 'https://cdn.test/files/old.doc?email=1' },
      ])
    })

    it('links an archive (zip)', async () => {
      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'bundle.zip',
          url: '/api/storage/files/bundle.zip?read=sig',
          contentType: 'application/zip',
          family: 'archive',
          size: 50,
        }),
      ])

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.linked).toEqual([
        { name: 'bundle.zip', url: 'https://cdn.test/files/bundle.zip?email=1' },
      ])
    })

    it('links a code-family file (html) despite being text', async () => {
      const result = await resolveEmailAttachments([
        attachment({
          fileId: 'file_1',
          name: 'page.html',
          url: '/api/storage/files/page.html?read=sig',
          contentType: 'text/html',
          family: 'code',
          size: 50,
        }),
      ])

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.linked).toEqual([
        { name: 'page.html', url: 'https://cdn.test/files/page.html?email=1' },
      ])
    })
  })

  describe('per-email budget', () => {
    it('links files that would overflow the per-email budget, preserving order', async () => {
      const big = attachment({
        fileId: 'file_big',
        name: 'big.png',
        url: '/api/storage/files/big.png?read=sig',
        contentType: 'image/png',
        family: 'image',
        size: MAX_EMAIL_ATTACHMENT_BYTES,
      })
      const small = attachment({
        fileId: 'file_small',
        name: 'small.txt',
        url: '/api/storage/files/small.txt?read=sig',
        contentType: 'text/plain',
        family: 'text',
        size: 10,
      })
      getS3Object.mockResolvedValue({
        body: streamOf(new Uint8Array(MAX_EMAIL_ATTACHMENT_BYTES)),
        contentType: 'image/png',
      })

      const result = await resolveEmailAttachments([big, small])

      // big.png alone claims the whole budget, so small.txt never fits behind it.
      expect(result.attachments).toHaveLength(1)
      expect(result.attachments[0].filename).toBe('big.png')
      expect(result.linked).toEqual([
        { name: 'small.txt', url: 'https://cdn.test/files/small.txt?email=1' },
      ])
      expect(getS3Object).toHaveBeenCalledTimes(1)
    })

    it('budgets a fileId attachment by its stored size without touching storage first', async () => {
      const bytes = new TextEncoder().encode('%PDF-1.4')
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'application/pdf' })

      const result = await resolveEmailAttachments([
        attachment({ fileId: 'file_1', size: MAX_EMAIL_ATTACHMENT_BYTES + 1 }),
      ])

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.attachments).toEqual([])
      expect(result.linked).toEqual([
        { name: 'a.pdf', url: 'https://cdn.test/files/a.pdf?email=1' },
      ])
    })

    it('attaches a legacy attachment within budget once storage confirms its size', async () => {
      const bytes = new TextEncoder().encode('%PDF-1.4')
      getS3Object.mockResolvedValue({
        body: streamOf(bytes),
        contentType: 'application/pdf',
        contentLength: bytes.byteLength,
      })

      const result = await resolveEmailAttachments([attachment({ size: bytes.byteLength })])

      expect(result.attachments).toEqual([
        { filename: 'a.pdf', contentType: 'application/pdf', content: bytes },
      ])
      expect(result.linked).toEqual([])
    })

    it('links a legacy attachment whose declared size understates the real object', async () => {
      getS3Object.mockResolvedValue({
        body: streamOf(new Uint8Array(MAX_EMAIL_ATTACHMENT_BYTES + 1)),
        contentType: 'application/pdf',
        contentLength: MAX_EMAIL_ATTACHMENT_BYTES + 1,
      })

      // Declares a tiny size, but the object itself reports the real (over
      // budget) length — the declared number is never trusted for a legacy row.
      const result = await resolveEmailAttachments([attachment({ size: 10 })])

      expect(result.attachments).toEqual([])
      expect(result.linked).toEqual([
        { name: 'a.pdf', url: 'https://cdn.test/files/a.pdf?email=1' },
      ])
    })

    it('links a legacy attachment when storage reports no content length', async () => {
      const bytes = new TextEncoder().encode('%PDF-1.4')
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'application/pdf' })

      const result = await resolveEmailAttachments([attachment({ size: bytes.byteLength })])

      expect(result.attachments).toEqual([])
      expect(result.linked).toEqual([
        { name: 'a.pdf', url: 'https://cdn.test/files/a.pdf?email=1' },
      ])
    })
  })

  describe('trustedSender', () => {
    it('links every attachment, whatever its type, when the sender is not trusted', async () => {
      const bytes = new TextEncoder().encode('%PDF-1.4')
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'application/pdf' })

      const result = await resolveEmailAttachments(
        [attachment({ fileId: 'file_1', size: bytes.byteLength })],
        { trustedSender: false }
      )

      expect(getS3Object).not.toHaveBeenCalled()
      expect(result.attachments).toEqual([])
      expect(result.linked).toEqual([
        { name: 'a.pdf', url: 'https://cdn.test/files/a.pdf?email=1' },
      ])
    })

    it('attaches normally when trustedSender is left at its default', async () => {
      const bytes = new TextEncoder().encode('%PDF-1.4')
      getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'application/pdf' })

      const result = await resolveEmailAttachments([
        attachment({ fileId: 'file_1', size: bytes.byteLength }),
      ])

      expect(result.attachments).toEqual([
        { filename: 'a.pdf', contentType: 'application/pdf', content: bytes },
      ])
    })
  })
})

describe('appendLinkedAttachmentsHtml', () => {
  it('leaves the body untouched when there is nothing to link', () => {
    expect(appendLinkedAttachmentsHtml('<p>hi</p>', [])).toBe('<p>hi</p>')
  })

  it('appends an Attachments list, escaping the file name', () => {
    const html = appendLinkedAttachmentsHtml('<p>hi</p>', [
      { name: '<script>.pdf', url: 'https://cdn.test/a?email=1' },
    ])
    expect(html).toContain('<p>hi</p>')
    expect(html).toContain('Attachments')
    expect(html).toContain('href="https://cdn.test/a?email=1"')
    expect(html).toContain('&lt;script&gt;.pdf')
    expect(html).not.toContain('<script>.pdf"')
  })
})
