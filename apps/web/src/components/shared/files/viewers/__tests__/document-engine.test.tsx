// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"disableIframePageLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import './browser-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { strToU8 } from 'fflate'
import type { EngineToolbar, ViewerEngineProps, ViewerFile } from '../../types'
import DocumentEngine from '../document-engine'
import { DOCUMENT_CSP } from '../document-render'
import { docxFixture, toArrayBuffer } from './docx-fixture'
import { withLayoutSize } from './layout-size'

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

    expect(el.getAttribute('sandbox')).toBe('')
    const srcdoc = el.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain(`content="${DOCUMENT_CSP}"`)
    expect(srcdoc).toContain('Quarterly plan')
    expect(srcdoc).not.toMatch(/<script|javascript:|tracker\.example/i)
    expect(p.onError).not.toHaveBeenCalled()
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

  it('refuses a package over the zip budget before parsing it', async () => {
    const p = props(file('huge.docx'), toArrayBuffer(docxFixture({ extraEntries: 2001 })))
    const { container } = render(<DocumentEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('too_large'))
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('reports bytes that are not a Word document as corrupt', async () => {
    const p = props(file('fake.docx'), strToU8('not a zip at all').buffer as ArrayBuffer)
    render(<DocumentEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('corrupt'))
  })
})
