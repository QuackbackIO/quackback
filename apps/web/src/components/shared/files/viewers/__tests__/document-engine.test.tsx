// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"disableIframePageLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import './browser-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { strToU8 } from 'fflate'
import type { EngineToolbar, ViewerEngineProps, ViewerFile } from '../../types'
import DocumentEngine from '../document-engine'
import { DOCUMENT_CSP } from '../document-render'
import { docxFixture, toArrayBuffer } from './docx-fixture'
import { declareSize } from './zip-fixtures'
import { withLayoutSize } from './layout-size'

function render(node: React.ReactNode) {
  return rtlRender(
    <IntlProvider locale="en-US" messages={{}}>
      {node}
    </IntlProvider>
  )
}

let restoreLayout: () => void
beforeEach(() => {
  restoreLayout = withLayoutSize(1000, 700)
})
afterEach(() => {
  cleanup()
  restoreLayout()
})

function file(name: string, extra: Partial<ViewerFile> = {}): ViewerFile {
  return {
    key: name,
    url: `/api/storage/files/${name}`,
    name,
    contentType: '',
    size: 1,
    family: 'document',
    ...extra,
  }
}

function props(f: ViewerFile, data: ArrayBuffer) {
  return {
    file: f,
    data,
    truncated: false,
    src: '',
    onToolbar: vi.fn<(t: EngineToolbar) => void>(),
    onError: vi.fn(),
    compact: false,
  } satisfies ViewerEngineProps
}

async function frame(container: HTMLElement): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const el = container.querySelector('iframe')
    if (!el) throw new Error('no frame yet')
    return el
  })
}

function lastToolbar(p: ReturnType<typeof props>): EngineToolbar {
  const calls = p.onToolbar.mock.calls
  if (calls.length === 0) throw new Error('no toolbar reported')
  return calls[calls.length - 1]![0]
}

describe('DocumentEngine', () => {
  it('shows the document in a frame with no scripts, no origin and a strict policy', async () => {
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    const el = await frame(container)

    // Popups only, so links can open a new tab; never scripts or an origin.
    expect(el.getAttribute('sandbox')!.split(/\s+/).sort()).toEqual([
      'allow-popups',
      'allow-popups-to-escape-sandbox',
    ])
    const srcdoc = el.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain(`content="${DOCUMENT_CSP}"`)
    expect(srcdoc).toContain('Quarterly plan')
    expect(srcdoc).not.toMatch(/<script|javascript:|tracker\.example/i)
    expect(p.onError).not.toHaveBeenCalled()
  })

  it('opens web and mail links in a new tab, as PDF links do, and drops every other link', async () => {
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    const el = await frame(container)
    const doc = new DOMParser().parseFromString(el.getAttribute('srcdoc') ?? '', 'text/html')

    const links = Array.from(doc.querySelectorAll('a[href]'))
    expect(links.map((a) => a.getAttribute('href')).sort()).toEqual([
      'https://example.com/docs',
      'mailto:help@example.com',
    ])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    // The script link and the in-document anchor keep their text, not a target.
    expect(doc.body.textContent).toContain('Click me')
    expect(doc.body.textContent).toContain('Back to the top')
  })

  it('takes the keyboard back when a click moves focus into the frame', async () => {
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    const el = await frame(container)
    el.focus()
    expect(document.activeElement).toBe(el)
    window.dispatchEvent(new Event('blur'))
    // Focus returns to the engine's own area, inside the viewer, so Escape,
    // the arrows, zoom and find reach the viewer again.
    await waitFor(() => expect(document.activeElement).toBe(el.parentElement))
    expect(el.parentElement).toHaveAttribute('tabindex', '-1')
  })

  it('leaves focus alone when the window loses it elsewhere', async () => {
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    await frame(container)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    window.dispatchEvent(new Event('blur'))
    await new Promise((r) => setTimeout(r, 10))
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('never puts the document into the page itself', async () => {
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    await frame(container)
    expect(document.body.textContent).not.toContain('Quarterly plan')
    expect(document.querySelector('section.docx')).toBeNull()
  })

  it('reports zoom, and zooming re-renders the frame at the new scale', async () => {
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    await frame(container)
    await waitFor(() => expect(lastToolbar(p).zoom).toBeDefined())
    expect(lastToolbar(p).zoom).toMatchObject({ value: 1, max: 2 })
    expect(lastToolbar(p).zoom!.min).toBeLessThanOrEqual(0.5)
    expect(lastToolbar(p).page).toBeUndefined()

    act(() => lastToolbar(p).zoom!.set(1.5))
    await waitFor(() => expect(lastToolbar(p).zoom!.value).toBe(1.5))
    expect(container.querySelector('iframe')!.getAttribute('srcdoc')).toMatch(/zoom:\s*1\.5/)

    act(() => lastToolbar(p).zoom!.set(9))
    await waitFor(() => expect(lastToolbar(p).zoom!.value).toBe(2))
  })

  it('fits a page to a narrow surface', async () => {
    restoreLayout()
    restoreLayout = withLayoutSize(440, 700)
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    render(<DocumentEngine {...p} />)
    await waitFor(() => expect(lastToolbar(p).zoom).toBeDefined())
    // A Letter page is 816px; 440px less the desk padding fits at about half.
    const { value, min } = lastToolbar(p).zoom!
    expect(value).toBeGreaterThan(0.45)
    expect(value).toBeLessThan(0.55)
    expect(min).toBeLessThanOrEqual(value)
  })

  it('notes the page count when the preview job knows it', async () => {
    const p = props(file('plan.docx', { preview: { pages: 4 } }), toArrayBuffer(docxFixture()))
    render(<DocumentEngine {...p} />)
    await waitFor(() => expect(lastToolbar(p).note).toBe('4 pages'))
  })

  it('notes macros, and still shows the document without running them', async () => {
    const p = props(file('plan.docm', { preview: { pages: 1 } }), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    await frame(container)
    await waitFor(() => expect(lastToolbar(p).note).toBe('1 page · Contains macros'))

    const flagged = props(
      file('plan.docx', { preview: { macro: true } }),
      toArrayBuffer(docxFixture())
    )
    render(<DocumentEngine {...flagged} />)
    await waitFor(() => expect(lastToolbar(flagged).note).toBe('Contains macros'))
  })

  it('notes the page count in German when the viewer locale is German', async () => {
    const p = props(file('plan.docx', { preview: { pages: 4 } }), toArrayBuffer(docxFixture()))
    rtlRender(
      <IntlProvider
        locale="de"
        messages={{
          'files.count.pages': '{count, plural, one {# Seite} other {# Seiten}}',
        }}
      >
        <DocumentEngine {...p} />
      </IntlProvider>
    )
    await waitFor(() => expect(lastToolbar(p).note).toBe('4 Seiten'))
  })

  it('shows the viewer’s loading state until the pages are ready', async () => {
    const p = props(file('plan.docx'), toArrayBuffer(docxFixture()))
    const { container } = render(<DocumentEngine {...p} />)
    expect(screen.getByRole('status', { name: 'Loading file' })).toBeInTheDocument()
    await frame(container)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reports a document with nothing in it as empty instead of a blank page', async () => {
    const p = props(
      file('blank.docx'),
      toArrayBuffer(
        docxFixture({ body: '<w:p/><w:p><w:r><w:t xml:space="preserve">  </w:t></w:r></w:p>' })
      )
    )
    const { container } = render(<DocumentEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('empty'))
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('refuses a package over the zip budget before parsing it', async () => {
    const p = props(file('huge.docx'), toArrayBuffer(docxFixture({ extraEntries: 2001 })))
    const { container } = render(<DocumentEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('too_large'))
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('refuses a package whose part inflates past the size its headers declare', async () => {
    const lying = declareSize(docxFixture(), 'word/document.xml', 64)
    const p = props(file('bomb.docx'), toArrayBuffer(lying))
    const { container } = render(<DocumentEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('corrupt'))
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('refuses a package whose local header disagrees with its index', async () => {
    const lying = declareSize(docxFixture(), 'word/document.xml', 9_999_999, 'local')
    const p = props(file('odd.docx'), toArrayBuffer(lying))
    render(<DocumentEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('corrupt'))
  })

  it('reports bytes that are not a Word document as corrupt', async () => {
    const p = props(file('fake.docx'), strToU8('not a zip at all').buffer as ArrayBuffer)
    render(<DocumentEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('corrupt'))
  })
})
