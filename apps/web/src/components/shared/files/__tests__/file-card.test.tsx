// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, fireEvent } from '@testing-library/react'
import { createIntl, IntlProvider } from 'react-intl'
import {
  attachmentMetaLine,
  attachmentAriaLabel,
  hasPreviewWorthShowing,
  resolveFamily,
  FilePreviewCard,
  FileIconCard,
  FileRow,
} from '../file-card'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import { downloadUrl } from '../download-url'

const intl = createIntl({ locale: 'en-US', messages: {} })

function render(node: React.ReactNode) {
  return rtlRender(
    <IntlProvider locale="en-US" messages={{}}>
      {node}
    </IntlProvider>
  )
}

function attachment(overrides: Partial<ConversationAttachment> = {}): ConversationAttachment {
  return {
    url: '/api/storage/files/a.pdf?read=sig',
    name: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 184 * 1024,
    family: 'pdf',
    ...overrides,
  }
}

describe('attachmentMetaLine', () => {
  it('shows PDF page count with size', () => {
    expect(attachmentMetaLine('a.pdf', 'pdf', 184 * 1024, { pages: 2 }, intl)).toBe(
      '2 pages · 184 KB'
    )
  })

  it('falls back to the family name and size when a PDF has no page count yet', () => {
    expect(attachmentMetaLine('a.pdf', 'pdf', 1024, {}, intl)).toBe('PDF · 1 KB')
  })

  it('shows a single page without the plural s', () => {
    expect(attachmentMetaLine('a.pdf', 'pdf', 1024, { pages: 1 }, intl)).toBe('1 page · 1 KB')
  })

  it('shows row count with size for a multi-sheet workbook, dropping the sheet count to keep the line short', () => {
    expect(
      attachmentMetaLine(
        'b.xlsx',
        'spreadsheet',
        312 * 1024,
        { sheets: ['Articles', 'Tags', 'Summary'], rows: 1248 },
        intl
      )
    ).toBe('1,248 rows · 312 KB')
  })

  it('shows rows with size for a single-sheet spreadsheet or a CSV', () => {
    expect(attachmentMetaLine('c.csv', 'csv', 1024, { rows: 1248 }, intl)).toBe('1,248 rows · 1 KB')
  })

  it('shows sheet count with size when the sheet count is known but rows are not', () => {
    expect(
      attachmentMetaLine(
        'b.xlsx',
        'spreadsheet',
        387 * 1024,
        { sheets: ['Articles', 'Tags', 'Summary'] },
        intl
      )
    ).toBe('3 sheets · 387 KB')
  })

  it('falls back to the family name and size when a spreadsheet has no counts', () => {
    expect(attachmentMetaLine('b.xlsx', 'spreadsheet', 1024, {}, intl)).toBe('Spreadsheet · 1 KB')
  })

  it('shows line count with size for text and code', () => {
    expect(attachmentMetaLine('log.txt', 'text', 22 * 1024, { lines: 418 }, intl)).toBe(
      '418 lines · 22 KB'
    )
  })

  it('shows duration with size for video', () => {
    expect(
      attachmentMetaLine(
        'rec.mp4',
        'video',
        Math.round(18.4 * 1024 * 1024),
        { durationMs: 134_000 },
        intl
      )
    ).toBe('2:14 · 18.4 MB')
  })

  it('shows dimensions with size for images', () => {
    expect(
      attachmentMetaLine('shot.png', 'image', 241 * 1024, { width: 1440, height: 900 }, intl)
    ).toBe('1440 × 900 · 241 KB')
  })

  it('shows entry count with size for an archive', () => {
    expect(attachmentMetaLine('z.zip', 'archive', 1024, { entries: 16 }, intl)).toBe(
      '16 files · 1 KB'
    )
  })

  it('falls back to the family name and size for a family with no rich rule', () => {
    expect(attachmentMetaLine('q.pptx', 'presentation', 1024, undefined, intl)).toBe(
      'Presentation · 1 KB'
    )
  })

  it('renders the meta line and family fallback in German when the locale is German', () => {
    const de = createIntl({
      locale: 'de',
      messages: {
        'files.count.pages': '{count, plural, one {# Seite} other {# Seiten}}',
        'files.family.spreadsheet': 'Tabelle',
      },
    })
    expect(attachmentMetaLine('a.pdf', 'pdf', 184 * 1024, { pages: 2 }, de)).toBe(
      '2 Seiten · 184 KB'
    )
    expect(attachmentMetaLine('b.xlsx', 'spreadsheet', 1024, {}, de)).toBe('Tabelle · 1 KB')
  })
})

describe('attachmentAriaLabel', () => {
  it('names the family and the specific count a sighted person only sees in the badge/meta line', () => {
    expect(attachmentAriaLabel('invoice.pdf', 'pdf', 184 * 1024, { pages: 2 }, intl)).toBe(
      'Open invoice.pdf, PDF, 2 pages, 184 KB'
    )
  })

  it('names the family and size alone when there is no specific count yet', () => {
    expect(attachmentAriaLabel('b.xlsx', 'spreadsheet', 1024, {}, intl)).toBe(
      'Open b.xlsx, Spreadsheet, 1 KB'
    )
  })

  it('renders in German when the locale is German', () => {
    const de = createIntl({
      locale: 'de',
      messages: {
        'files.card.openWithMeta': '{name} öffnen, {detail}',
        'files.count.pages': '{count, plural, one {# Seite} other {# Seiten}}',
      },
    })
    expect(attachmentAriaLabel('invoice.pdf', 'pdf', 184 * 1024, { pages: 2 }, de)).toBe(
      'invoice.pdf öffnen, PDF, 2 Seiten, 184 KB'
    )
  })
})

describe('resolveFamily', () => {
  it('prefers the stored family', () => {
    expect(resolveFamily(attachment({ family: 'pdf', contentType: 'application/zip' }))).toBe('pdf')
  })

  it('derives the family from name/type for a legacy attachment with no family', () => {
    expect(
      resolveFamily({
        url: 'https://cdn.example.com/a.png',
        name: 'a.png',
        contentType: 'image/png',
        size: 10,
      })
    ).toBe('image')
  })
})

describe('hasPreviewWorthShowing', () => {
  it('is true for video, with no preview at all', () => {
    expect(hasPreviewWorthShowing(attachment({ family: 'video', preview: undefined }))).toBe(true)
  })

  it('is true with a thumbnail, head rows, or a text excerpt', () => {
    expect(hasPreviewWorthShowing(attachment({ preview: { thumbUrl: 'x' } }))).toBe(true)
    expect(hasPreviewWorthShowing(attachment({ preview: { head: [['a']] } }))).toBe(true)
    expect(hasPreviewWorthShowing(attachment({ preview: { text: 'hi' } }))).toBe(true)
  })

  it('is false with no preview, or an empty one', () => {
    expect(hasPreviewWorthShowing(attachment({ preview: undefined }))).toBe(false)
    expect(hasPreviewWorthShowing(attachment({ preview: { pages: 2 } }))).toBe(false)
    expect(hasPreviewWorthShowing(attachment({ preview: { head: [] } }))).toBe(false)
  })
})

describe('FilePreviewCard', () => {
  it('opens the viewer from one button, not from the download link', () => {
    const onOpen = vi.fn()
    const { getByRole } = render(
      <FilePreviewCard attachment={attachment({ preview: { pages: 2 } })} onOpen={onOpen} />
    )
    const openButton = getByRole('button', { name: 'Open invoice.pdf, PDF, 2 pages, 184 KB' })
    fireEvent.click(openButton)
    expect(onOpen).toHaveBeenCalledTimes(1)

    const download = getByRole('link', { name: 'Download invoice.pdf' })
    expect(download).toHaveAttribute('href', downloadUrl(attachment().url, 'invoice.pdf'))
    expect(download).toHaveAttribute('download', 'invoice.pdf')
    fireEvent.click(download)
    // The download link stops propagation so clicking it never also opens the viewer.
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('renders the macro warning as a suffix beside the meta line, not instead of it', () => {
    const { getByText } = render(
      <FilePreviewCard
        attachment={attachment({
          family: 'spreadsheet',
          preview: { rows: 10, macro: true },
        })}
        onOpen={() => {}}
      />
    )
    expect(getByText('10 rows · 184 KB')).toBeTruthy()
    expect(getByText('Contains macros')).toBeTruthy()
  })

  it('warns about macros for a macro-enabled extension even when the preview job never flagged it', () => {
    // The viewer's mayHaveMacros() also treats the extension itself as
    // macro-enabled; the card must agree, not only trust preview.macro.
    const { getByText } = render(
      <FilePreviewCard
        attachment={attachment({
          name: 'workbook.xlsm',
          family: 'spreadsheet',
          preview: { rows: 10 },
        })}
        onOpen={() => {}}
      />
    )
    expect(getByText('Contains macros')).toBeTruthy()
  })
})

describe('FileIconCard', () => {
  it('is a single button with the badge, name and meta line', () => {
    const onOpen = vi.fn()
    const { getByRole } = render(
      <FileIconCard
        attachment={attachment({ family: 'document', preview: { pages: 4 } })}
        onOpen={onOpen}
      />
    )
    const button = getByRole('button', { name: 'Open invoice.pdf, Document, 4 pages, 184 KB' })
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('FileRow', () => {
  it('opens the viewer and exposes a separate, accessible download link', () => {
    const onOpen = vi.fn()
    const { getByRole } = render(<FileRow attachment={attachment()} onOpen={onOpen} />)
    fireEvent.click(getByRole('button', { name: 'Open invoice.pdf, PDF, 184 KB' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(getByRole('link', { name: 'Download invoice.pdf' })).toHaveAttribute(
      'href',
      downloadUrl(attachment().url, 'invoice.pdf')
    )
  })

  it('keeps the download icon visible without hover, for touch devices', () => {
    const { getByRole } = render(<FileRow attachment={attachment()} onOpen={() => {}} />)
    const classes = getByRole('link', { name: 'Download invoice.pdf' }).className.split(/\s+/)
    expect(classes).not.toContain('opacity-0')
    expect(classes).toContain('[@media(hover:hover)]:opacity-0')
  })
})
