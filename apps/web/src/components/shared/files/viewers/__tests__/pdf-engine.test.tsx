// @vitest-environment happy-dom
/**
 * The PDF engine against a stand-in for pdf.js: documents of any page count
 * whose pages have known text, answering the calls the engine makes (open,
 * pages, viewports, text content, annotations, drawing) the way pdf.js does,
 * minus the pixels. Each assertion reads what the engine itself decides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { EngineToolbar, ViewerEngineProps, ViewerFile } from '../../types'
import { withLayoutSize } from './layout-size'

const fake = vi.hoisted(() => {
  const state = {
    /** Text runs per page; the document has one page per entry. */
    pages: [] as string[][],
    /** Resolves the open, for tests that hold the document back. */
    release: null as (() => void) | null,
    hold: false,
    destroyed: 0,
  }

  function viewport(scale: number) {
    return {
      width: 612 * scale,
      height: 792 * scale,
      scale,
      userUnit: 1,
      convertToViewportPoint: (x: number, y: number) => [x * scale, (792 - y) * scale],
    }
  }

  function page(runs: string[]) {
    return {
      getViewport: ({ scale }: { scale: number }) => viewport(scale),
      render: () => ({ promise: Promise.resolve(), cancel() {} }),
      getTextContent: async () => ({
        items: runs.map((str) => ({ str, hasEOL: true })),
      }),
      getAnnotations: async () => [],
    }
  }

  function document() {
    const pages = state.pages
    return {
      numPages: pages.length,
      getPage: async (n: number) => {
        if (n < 1 || n > pages.length) throw new Error(`No page ${n}`)
        return page(pages[n - 1]!)
      },
    }
  }

  class TextLayer {
    static cleanup() {}
    textDivs: HTMLElement[] = []
    textContentItemsStr: string[] = []
    #source: { items: { str: string }[] }
    #container: HTMLElement
    constructor(options: {
      textContentSource: { items: { str: string }[] }
      container: HTMLElement
    }) {
      this.#source = options.textContentSource
      this.#container = options.container
    }
    async render() {
      for (const item of this.#source.items) {
        const span = this.#container.ownerDocument.createElement('span')
        span.textContent = item.str
        this.#container.append(span)
        this.textDivs.push(span)
        this.textContentItemsStr.push(item.str)
      }
    }
    cancel() {}
  }

  return {
    state,
    module: {
      GlobalWorkerOptions: {} as { workerSrc?: string },
      AnnotationMode: { ENABLE: 1 },
      TextLayer,
      getDocument: () => {
        const opened = state.hold
          ? new Promise<void>((resolve) => {
              state.release = resolve
            })
          : Promise.resolve()
        return {
          promise: opened.then(() => document()),
          destroy: async () => {
            state.destroyed++
          },
        }
      },
    },
  }
})

vi.mock('pdfjs-dist', () => fake.module)

const { default: PdfEngine } = await import('../pdf-engine')

function render(node: React.ReactNode) {
  return rtlRender(
    <IntlProvider locale="en" messages={{}}>
      {node}
    </IntlProvider>
  )
}

const file: ViewerFile = {
  key: 'report.pdf',
  url: '/api/storage/files/report.pdf',
  name: 'report.pdf',
  contentType: 'application/pdf',
  size: 1000,
  family: 'pdf',
}

function props({ compact = false }: { compact?: boolean } = {}) {
  return {
    file,
    data: new ArrayBuffer(8),
    truncated: false,
    src: '',
    onToolbar: vi.fn<(t: EngineToolbar) => void>(),
    onError: vi.fn(),
    compact,
  } satisfies ViewerEngineProps
}

function lastToolbar(p: ReturnType<typeof props>): EngineToolbar {
  const calls = p.onToolbar.mock.calls
  if (calls.length === 0) throw new Error('no toolbar reported')
  return calls[calls.length - 1]![0]
}

let restoreLayout: () => void
beforeEach(() => {
  fake.state.pages = [['Quarterly report'], ['Revenue grew'], ['Revenue fell']]
  fake.state.hold = false
  fake.state.release = null
  fake.state.destroyed = 0
  restoreLayout = withLayoutSize(1000, 700)
})
afterEach(() => {
  cleanup()
  restoreLayout()
})

describe('PdfEngine', () => {
  it('shows the viewer’s loading state until the document opens', async () => {
    fake.state.hold = true
    const p = props()
    render(<PdfEngine {...p} />)
    expect(screen.getByRole('status', { name: 'Loading file' })).toBeInTheDocument()
    await waitFor(() => expect(fake.state.release).not.toBeNull())
    act(() => fake.state.release!())
    await waitFor(() => expect(lastToolbar(p).page).toMatchObject({ current: 1, total: 3 }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('group', { name: 'Page 1' })).toBeInTheDocument()
  })

  it('finds with the same bar as every other file: count, Enter, Shift+Enter, Escape', async () => {
    fake.state.pages = [['Quarterly report'], ['Revenue grew'], ['Revenue fell', 'revenue held']]
    const p = props()
    render(<PdfEngine {...p} />)
    await waitFor(() => expect(lastToolbar(p).find).toBeDefined())
    act(() => lastToolbar(p).find!.open())
    const input = await screen.findByRole('searchbox', { name: 'Find in file' })
    await waitFor(() => expect(input).toHaveFocus())

    fireEvent.change(input, { target: { value: 'revenue' } })
    // No verdict while the pages are still being searched.
    expect(screen.queryByText('No matches')).toBeNull()
    expect(await screen.findByText('1 of 3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('3 of 3')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'profit' } })
    expect(await screen.findByText('No matches')).toBeInTheDocument()

    // Escape closes the bar and is marked handled, so the viewer stays open.
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('lays out at most the first 500 pages and says so', async () => {
    fake.state.pages = Array.from({ length: 1200 }, (_, i) => [`needle on page ${i + 1}`])
    const p = props()
    const { container } = render(<PdfEngine {...p} />)
    await waitFor(() => expect(lastToolbar(p).page).toMatchObject({ current: 1, total: 500 }))
    expect(lastToolbar(p).note).toBe('Showing the first 500 pages')
    expect(container.querySelectorAll('[role="group"][data-page]')).toHaveLength(500)
    expect(container.querySelector('[data-page="501"]')).toBeNull()

    // Find reads only the pages laid out.
    act(() => lastToolbar(p).find!.open())
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find in file' }), {
      target: { value: 'needle' },
    })
    expect(await screen.findByText('1 of 500')).toBeInTheDocument()
  })

  it('has no note for a document within the cap', async () => {
    const p = props()
    render(<PdfEngine {...p} />)
    await waitFor(() => expect(lastToolbar(p).page).toMatchObject({ total: 3 }))
    expect(lastToolbar(p).note).toBeUndefined()
  })

  it('draws only the thumbnails near the rail’s view', async () => {
    fake.state.pages = Array.from({ length: 300 }, () => ['text'])
    const p = props()
    render(<PdfEngine {...p} />)
    const rail = await screen.findByRole('navigation', { name: 'Pages' })
    const thumbs = within(rail).getAllByRole('button')
    expect(thumbs.length).toBeGreaterThan(0)
    expect(thumbs.length).toBeLessThan(30)
    expect(thumbs[0]).toHaveAccessibleName('Page 1')
    expect(within(rail).queryByRole('button', { name: 'Page 300' })).toBeNull()
  })

  it('leaves the rail out of the widget’s narrow sheet', async () => {
    const p = props({ compact: true })
    render(<PdfEngine {...p} />)
    await waitFor(() => expect(lastToolbar(p).page).toMatchObject({ total: 3 }))
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  })
})
