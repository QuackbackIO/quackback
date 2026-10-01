/**
 * Splits a message's stored attachments into real MIME parts (within the
 * per-email byte budget) and links for everything else — too large once
 * earlier files have claimed their share, foreign (no storage key of ours to
 * load), or whose bytes failed to load.
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

  it('loads bytes for an attachment that fits the budget', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4')
    getS3Object.mockResolvedValue({ body: streamOf(bytes), contentType: 'application/pdf' })

    const result = await resolveEmailAttachments([attachment({ size: bytes.byteLength })])

    expect(getS3Object).toHaveBeenCalledWith('files/a.pdf')
    expect(result.attachments).toEqual([
      { filename: 'a.pdf', contentType: 'application/pdf', content: bytes },
    ])
    expect(result.linked).toEqual([])
  })

  it('links files that would overflow the per-email budget, preserving order', async () => {
    const big = attachment({
      name: 'big.zip',
      url: '/api/storage/files/big.zip?read=sig',
      size: MAX_EMAIL_ATTACHMENT_BYTES,
    })
    const small = attachment({
      name: 'small.txt',
      url: '/api/storage/files/small.txt?read=sig',
      size: 10,
    })
    getS3Object.mockResolvedValue({
      body: streamOf(new Uint8Array(MAX_EMAIL_ATTACHMENT_BYTES)),
      contentType: 'application/zip',
    })

    const result = await resolveEmailAttachments([big, small])

    // big.zip alone claims the whole budget, so small.txt never fits behind it.
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0].filename).toBe('big.zip')
    expect(result.linked).toEqual([
      { name: 'small.txt', url: 'https://cdn.test/files/small.txt?email=1' },
    ])
    expect(getS3Object).toHaveBeenCalledTimes(1)
  })

  it('links a file whose bytes fail to load instead of dropping it', async () => {
    getS3Object.mockRejectedValue(new Error('object not found'))

    const result = await resolveEmailAttachments([attachment()])

    expect(result.attachments).toEqual([])
    expect(result.linked).toEqual([{ name: 'a.pdf', url: 'https://cdn.test/files/a.pdf?email=1' }])
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

  it('drops a linked entry rather than emitting a broken url when none can be built', async () => {
    getEmailSafeUrl.mockReturnValue(null)
    getS3Object.mockRejectedValue(new Error('object not found'))

    const result = await resolveEmailAttachments([attachment()])

    expect(result.attachments).toEqual([])
    expect(result.linked).toEqual([])
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
