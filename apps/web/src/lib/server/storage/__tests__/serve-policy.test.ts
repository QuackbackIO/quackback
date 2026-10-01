import { describe, expect, it } from 'vitest'
import {
  attachmentDisposition,
  cleanDownloadName,
  downloadFileName,
  isInlineType,
  redirectPolicy,
} from '../serve-policy'

/**
 * What a stored file may do when a browser opens it. Its Content-Type comes
 * from whoever uploaded or sent it, so only types that cannot run anything are
 * shown inline; everything else is a download.
 */
describe('isInlineType', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/x-m4v', 'video/m4v', 'audio/mpeg', 'application/pdf', 'IMAGE/PNG', 'image/png; charset=binary'])(
    'shows %s inline',
    (type) => expect(isInlineType(type)).toBe(true)
  )

  it.each(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/javascript', 'text/plain', 'application/octet-stream', ''])(
    'downloads %s',
    (type) => expect(isInlineType(type)).toBe(false)
  )
})

describe('redirectPolicy', () => {
  // The redirect does not see the stored type, so it goes by the key's
  // extension and forces that extension's type: a page named .pdf still
  // arrives as a PDF, never as HTML.
  it('forces the canonical type for an inline extension', () => {
    expect(redirectPolicy('chat-images/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-photo.png')).toEqual({ inlineType: 'image/png' })
    expect(redirectPolicy('chat-files/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-report.PDF')).toEqual({ inlineType: 'application/pdf' })
  })

  it('keeps every video type uploads accept inline, M4V included', () => {
    expect(redirectPolicy('post-media/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-demo.m4v')).toEqual({ inlineType: 'video/x-m4v' })
  })

  it('downloads anything else, under a readable name', () => {
    expect(redirectPolicy('chat-files/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-invoice.html')).toEqual({ downloadName: 'invoice.html' })
    expect(redirectPolicy('chat-files/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-drawing.svg')).toEqual({ downloadName: 'drawing.svg' })
    expect(redirectPolicy('exports/workspace')).toEqual({ downloadName: 'workspace' })
  })
})

describe('downloadFileName', () => {
  it('drops the storage id and keeps the name the file was sent with', () => {
    expect(downloadFileName('chat-files/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-q3-report.xlsx')).toBe('q3-report.xlsx')
  })

  it('never lets a quote or a line break into the header', () => {
    expect(downloadFileName('chat-files/a"b\r\nx: y.html')).toBe('a_b__x__y.html')
  })
})

describe('attachmentDisposition', () => {
  it('names the file exactly in filename* and in printable ASCII in filename', () => {
    expect(attachmentDisposition("Q3 (draft)*'s.pdf")).toBe(
      `attachment; filename="Q3 (draft)*'s.pdf"; filename*=UTF-8''Q3%20%28draft%29%2A%27s.pdf`
    )
    expect(attachmentDisposition('\u{1F4C4} 100%.pdf')).toBe(
      `attachment; filename="_ 100_.pdf"; filename*=UTF-8''%F0%9F%93%84%20100%25.pdf`
    )
  })

  it('never lets a quote, backslash or line break into the header', () => {
    const header = attachmentDisposition('a"b\\c\r\nX-Evil: 1')
    expect(header).not.toMatch(/[\r\n]/)
    expect(header).toBe(
      `attachment; filename="a_b_c__X-Evil: 1"; filename*=UTF-8''a%22b%5Cc%0D%0AX-Evil%3A%201`
    )
  })
})

describe('cleanDownloadName', () => {
  it('keeps letters of every script and drops what could reorder or hide them', () => {
    expect(cleanDownloadName('דוח.pdf')).toBe('דוח.pdf')
    expect(cleanDownloadName('Invoice‮xcod.docm')).toBe('Invoicexcod.docm')
    expect(cleanDownloadName(' ​ ')).toBeNull()
    expect(cleanDownloadName(null)).toBeNull()
  })
})
