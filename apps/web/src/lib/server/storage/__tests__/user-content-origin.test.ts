/**
 * With `USER_CONTENT_URL` set, attachment and file URLs handed to a browser
 * load from that origin. Only at read time: what a message stores stays the
 * host-independent `/api/storage/…` ref, so turning the setting off (or
 * moving the host) breaks nothing already written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationAttachment, FileRecord } from '@/lib/server/db'

const mockConfig = vi.hoisted(() => ({
  s3Bucket: 'env-bucket',
  s3Region: 'env-region',
  s3AccessKeyId: 'env-access-key',
  s3SecretAccessKey: 'fixture-secret',
  s3ForcePathStyle: true,
  s3Proxy: false,
  baseUrl: 'https://app.example.com',
  userContentUrl: undefined as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const { toUserContentUrl } = await import('../asset-url')
const { isTrustedAttachmentUrl } = await import('../trusted-url')
const { getPublicUrlOrNull } = await import('../s3')
const { attachmentForClient } = await import('@/lib/server/messages/message-core')
const { toUploadedFile, attachmentFromFile } =
  await import('@/lib/server/domains/files/files.service')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const FILES_HOST = 'https://files.example.com'
const FILE_KEY = 'files/2026/10/0b5c3f43-8d0a-4c4e-9a59-2f1d1f6c1a11-report.pdf'
const THUMB_KEY = 'files/2026/10/0b5c3f43-8d0a-4c4e-9a59-2f1d1f6c1a11-thumb.webp'

beforeEach(() => {
  mockConfig.userContentUrl = undefined
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 1, 9, 30))
})

afterEach(() => {
  vi.useRealTimers()
})

const fileRow = (): FileRecord =>
  ({
    id: 'file_01k6g8h0000000000000000000',
    storageKey: FILE_KEY,
    name: 'report.pdf',
    contentType: 'application/pdf',
    declaredType: null,
    family: 'pdf',
    size: 1234,
    sha256: 'a'.repeat(64),
    source: 'agent',
    uploadedById: null,
    messageId: null,
    attachedAt: null,
    previewStatus: 'ready',
    meta: { pages: 2, thumbKey: THUMB_KEY },
    textExcerpt: null,
    openCount: 0,
    createdAt: new Date(),
    deletedAt: null,
  }) as unknown as FileRecord

describe('toUserContentUrl', () => {
  it('leaves every URL alone when the setting is off', () => {
    const url = getPublicUrlOrNull(FILE_KEY)!
    expect(toUserContentUrl(url)).toBe(url)
  })

  it('moves a stored ref onto the user-content origin when it is on', () => {
    mockConfig.userContentUrl = FILES_HOST
    const url = getPublicUrlOrNull(FILE_KEY)!
    expect(toUserContentUrl(url)).toBe(`${FILES_HOST}${url}`)
    expect(toUserContentUrl('/api/storage/chat-images/a.png?read=x')).toBe(
      `${FILES_HOST}/api/storage/chat-images/a.png?read=x`
    )
  })

  it('never rewrites a URL that is not a stored ref', () => {
    mockConfig.userContentUrl = FILES_HOST
    for (const url of [
      'https://cdn.example.net/a.png',
      'https://app.example.com/api/storage/files/a.pdf',
      '//evil.example/api/storage/files/a.pdf',
      '/api/storage/',
      '/api/storage/../admin',
      '/admin',
      '',
    ]) {
      expect(toUserContentUrl(url), url).toBe(url)
    }
  })

  it('does nothing under a workspace scope, where one host cannot serve every workspace', () => {
    mockConfig.userContentUrl = FILES_HOST
    const url = '/api/storage/files/a.pdf?read=x&exp=1'
    expect(withWorkspace('workspace-alpha', () => toUserContentUrl(url))).toBe(url)
  })
})

describe('isTrustedAttachmentUrl and the user-content host', () => {
  const onFilesHost = `${FILES_HOST}/api/storage/${FILE_KEY}?read=x&exp=1`

  it('accepts a stored ref on the user-content host when the setting is on', () => {
    mockConfig.userContentUrl = FILES_HOST
    expect(isTrustedAttachmentUrl(onFilesHost)).toBe(true)
    expect(isTrustedAttachmentUrl(`${FILES_HOST}/admin`)).toBe(false)
    expect(isTrustedAttachmentUrl(`https://evil.example.com/api/storage/${FILE_KEY}`)).toBe(false)
  })

  it('refuses it when the setting is off', () => {
    expect(isTrustedAttachmentUrl(onFilesHost)).toBe(false)
    // The control: the app host is trusted either way.
    expect(isTrustedAttachmentUrl(`https://app.example.com/api/storage/${FILE_KEY}`)).toBe(true)
  })
})

describe('attachmentForClient', () => {
  const stored = (): ConversationAttachment => ({
    url: `/api/storage/${FILE_KEY}?read=old`,
    name: 'report.pdf',
    contentType: 'application/pdf',
    size: 1234,
    fileId: 'file_01k6g8h0000000000000000000',
    family: 'pdf',
    preview: { pages: 2, thumbKey: THUMB_KEY },
  })

  it('serves the file and its thumbnail from the user-content origin', () => {
    mockConfig.userContentUrl = FILES_HOST
    const original = stored()
    const out = attachmentForClient(original)
    expect(out.url).toBe(`${FILES_HOST}${getPublicUrlOrNull(FILE_KEY)}`)
    expect(out.preview?.thumbUrl).toBe(`${FILES_HOST}${getPublicUrlOrNull(THUMB_KEY)}`)
    // The stored attachment is not rewritten.
    expect(original).toEqual(stored())
  })

  it('stays relative when the setting is off', () => {
    const out = attachmentForClient(stored())
    expect(out.url).toBe(getPublicUrlOrNull(FILE_KEY))
    expect(out.preview?.thumbUrl).toBe(getPublicUrlOrNull(THUMB_KEY))
  })

  it('never mints a link for a pipeline file named by URL alone, without its id', () => {
    const { fileId: _id, ...byUrl } = stored()
    expect(attachmentForClient(byUrl).url).toBe(`/api/storage/${FILE_KEY}?read=old`)
    // Every other prefix keeps its fresh capability.
    const other = { ...byUrl, url: '/api/storage/attachments/2026/10/a.pdf?read=old' }
    expect(attachmentForClient(other).url).toBe(getPublicUrlOrNull('attachments/2026/10/a.pdf'))
  })
})

describe('file pipeline URLs', () => {
  it('gives the uploader an absolute user-content URL', () => {
    mockConfig.userContentUrl = FILES_HOST
    expect(toUploadedFile(fileRow()).url).toBe(`${FILES_HOST}${getPublicUrlOrNull(FILE_KEY)}`)
  })

  it('stores a host-independent ref on the message, whatever the setting', () => {
    mockConfig.userContentUrl = FILES_HOST
    const att = attachmentFromFile(fileRow())
    expect(att.url).toBe(getPublicUrlOrNull(FILE_KEY))
    expect(att.url.startsWith('/api/storage/')).toBe(true)
  })

  it('keeps the upload response relative when the setting is off', () => {
    expect(toUploadedFile(fileRow()).url).toBe(getPublicUrlOrNull(FILE_KEY))
  })
})
