// @vitest-environment happy-dom
/**
 * The viewer shell: one header, one gallery, one keyboard, one loading state
 * and one fallback for every format. Engines are replaced by a fake that shows
 * exactly what the shell handed it, so each assertion reads the shell's own
 * decisions (what it fetched, how, and what it passed on).
 */
import { useEffect, type ComponentType } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FileViewer, { type FileViewerProps } from '../file-viewer'
import type { EngineFailure, EngineToolbar, ViewerEngineProps, ViewerFile } from '../types'
import { TEXT_HEAD_BYTES, type EngineKind } from '../viewers'

let toolbarFor: (props: ViewerEngineProps) => EngineToolbar = () => ({})
let failWith: EngineFailure | null = null
let throwOnRender = false

function FakeEngine(props: ViewerEngineProps) {
  const { onToolbar, onError } = props
  useEffect(() => {
    onToolbar(toolbarFor(props))
    if (failWith) onError(failWith)
    // Report once per mount, as a real engine does after it renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onToolbar, onError])
  if (throwOnRender) throw new Error('engine crashed')
  return (
    <div>
      <div data-testid="engine">
        {[
          props.file.name,
          props.data ? props.data.byteLength : 'none',
          String(props.truncated),
          props.src,
          String(props.compact),
        ].join('|')}
      </div>
      <input aria-label="Engine field" />
    </div>
  )
}

const ENGINES: Record<EngineKind, ComponentType<ViewerEngineProps>> = {
  pdf: FakeEngine,
  document: FakeEngine,
  sheet: FakeEngine,
  text: FakeEngine,
  media: FakeEngine,
  archive: FakeEngine,
}

function file(over: Partial<ViewerFile> & { name: string }): ViewerFile {
  return {
    key: over.name,
    url: `/api/storage/files/${over.name}`,
    contentType: 'application/octet-stream',
    size: 1000,
    family: 'other',
    ...over,
  }
}

const invoice = file({
  name: 'invoice.pdf',
  family: 'pdf',
  fileId: 'file_invoice',
  url: '/api/storage/files/invoice.pdf?read=tok',
  size: 188_416,
  senderName: 'Dana Whitfield',
  sentAt: '2026-09-27T14:02:00.000Z',
  messageId: 'msg_1',
})
const contract = file({ name: 'contract.pdf', family: 'pdf', fileId: 'file_contract' })
const log = file({ name: 'import.log', family: 'text', fileId: 'file_log', size: 600_000 })
const deck = file({ name: 'q4-roadmap.pptx', family: 'presentation' })
const shot = file({ name: 'shot.png', family: 'image', contentType: 'image/png' })

let fetchMock: ReturnType<typeof vi.fn>
let beacon: ReturnType<typeof vi.fn>

function okBytes(n: number, init: ResponseInit = {}) {
  return new Response(new Uint8Array(n), { status: 200, ...init })
}

/** A fetch that never settles until its signal aborts. */
function pendingUntilAborted(_url: string, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
}

function renderViewer(
  props: Partial<FileViewerProps> = {},
  intl: { locale?: string; messages?: Record<string, string> } = {}
) {
  const onClose = vi.fn()
  const result = render(
    <IntlProvider locale={intl.locale ?? 'en-US'} messages={intl.messages ?? {}}>
      <FileViewer files={[invoice]} index={0} open onClose={onClose} engines={ENGINES} {...props} />
    </IntlProvider>
  )
  return { ...result, onClose }
}

function counter() {
  return screen.getByText(/^\d+ of \d+$/).textContent
}

beforeEach(() => {
  toolbarFor = () => ({})
  failWith = null
  throwOnRender = false
  fetchMock = vi.fn(async () => okBytes(1000))
  vi.stubGlobal('fetch', fetchMock)
  beacon = vi.fn(() => true)
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FileViewer header', () => {
  it('shows the name, who sent it, when, and how big', async () => {
    renderViewer()
    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.getByText(/^Dana Whitfield · .+ · 184 KB$/)).toBeVisible()
    // Plain text unless the surface can jump to the message.
    expect(screen.queryByRole('button', { name: /^Dana Whitfield/ })).toBeNull()
  })

  it('jumps to the message the file came from, closing the viewer', async () => {
    const onJumpToMessage = vi.fn()
    const { onClose } = renderViewer({ onJumpToMessage })
    fireEvent.click(await screen.findByRole('button', { name: /^Dana Whitfield/ }))
    expect(onJumpToMessage).toHaveBeenCalledWith('msg_1')
    expect(onClose).toHaveBeenCalled()
  })

  it('offers Download as a link the storage route answers as an attachment, named for the file', async () => {
    renderViewer({ files: [{ ...invoice, name: 'Prüfbericht März.pdf' }] })
    const link = await screen.findByRole('link', { name: 'Download' })
    // The `download` attribute is ignored across origins; the route's
    // Content-Disposition carries the name instead.
    expect(link).toHaveAttribute(
      'href',
      '/api/storage/files/invoice.pdf?read=tok&download=1&filename=Pr%C3%BCfbericht%20M%C3%A4rz.pdf'
    )
    expect(link).not.toHaveAttribute('download')
  })

  it('closes from the Close button', async () => {
    const { onClose } = renderViewer()
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('FileViewer gallery', () => {
  it('moves through the gallery and wraps at both ends', async () => {
    renderViewer({ files: [invoice, contract, deck], index: 2 })
    expect(await screen.findByText('3 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    expect(counter()).toBe('1 of 3')
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous file' }))
    expect(counter()).toBe('3 of 3')
    expect(screen.getByText('q4-roadmap.pptx')).toBeInTheDocument()
  })

  it('hides the gallery controls for a single file', async () => {
    renderViewer({ files: [invoice] })
    await screen.findByText('invoice.pdf')
    expect(screen.queryByRole('button', { name: 'Next file' })).toBeNull()
    expect(screen.queryByText('1 of 1')).toBeNull()
  })
})

describe('FileViewer keyboard', () => {
  it('moves with the arrow keys', async () => {
    renderViewer({ files: [invoice, contract, deck], index: 0 })
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(counter()).toBe('2 of 3')
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(counter()).toBe('3 of 3')
  })

  it('leaves the arrow keys to a text field', async () => {
    renderViewer({ files: [invoice, contract], index: 0 })
    const field = await screen.findByRole('textbox', { name: 'Engine field' })
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    expect(counter()).toBe('1 of 2')
  })

  it('leaves the arrow keys to an engine area that scrolls with them', async () => {
    renderViewer({ files: [invoice, contract], index: 0 })
    await screen.findByTestId('engine')
    const area = document.createElement('div')
    area.setAttribute('data-viewer-arrows', '')
    area.tabIndex = 0
    screen.getByTestId('engine').appendChild(area)
    fireEvent.keyDown(area, { key: 'ArrowRight' })
    expect(counter()).toBe('1 of 2')
  })

  it('closes on Escape', async () => {
    const { onClose } = renderViewer()
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('lets an engine take Escape first (a find bar closes before the dialog)', async () => {
    const { onClose } = renderViewer()
    const field = await screen.findByRole('textbox', { name: 'Engine field' })
    field.addEventListener('keydown', (e) => e.preventDefault())
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('drives a reported zoom with + - and 0', async () => {
    const set = vi.fn()
    toolbarFor = () => ({ zoom: { value: 1.5, min: 0.5, max: 2, set } })
    renderViewer()
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('150%')
    fireEvent.keyDown(dialog, { key: '+' })
    expect(set).toHaveBeenLastCalledWith(1.75)
    fireEvent.keyDown(dialog, { key: '-' })
    expect(set).toHaveBeenLastCalledWith(1.25)
    fireEvent.keyDown(dialog, { key: '0' })
    expect(set).toHaveBeenLastCalledWith(1)
  })

  it('clamps zoom to the range the engine reports', async () => {
    const set = vi.fn()
    toolbarFor = () => ({ zoom: { value: 2, min: 0.5, max: 2, set } })
    renderViewer()
    await screen.findByText('200%')
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(set).toHaveBeenLastCalledWith(1.75)
  })

  it('ignores zoom keys when the engine reports no zoom', async () => {
    renderViewer({ files: [invoice, contract] })
    const dialog = await screen.findByRole('dialog')
    expect(fireEvent.keyDown(dialog, { key: '+' })).toBe(true)
    expect(screen.queryByText(/%$/)).toBeNull()
  })

  it('routes Cmd/Ctrl+F to the engine find and keeps it from the browser', async () => {
    const open = vi.fn()
    toolbarFor = () => ({ find: { open } })
    renderViewer()
    const dialog = await screen.findByRole('dialog')
    await screen.findByRole('button', { name: 'Find' })
    const notPrevented = fireEvent.keyDown(dialog, { key: 'f', ctrlKey: true })
    expect(open).toHaveBeenCalledOnce()
    expect(notPrevented).toBe(false)
    fireEvent.keyDown(dialog, { key: 'f', metaKey: true })
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('leaves Cmd/Ctrl+F to the browser when the engine has no find', async () => {
    renderViewer()
    const dialog = await screen.findByRole('dialog')
    expect(fireEvent.keyDown(dialog, { key: 'f', ctrlKey: true })).toBe(true)
  })
})

describe('FileViewer toolbar', () => {
  it('draws the controls the engine reports', async () => {
    const go = vi.fn()
    const toggle = vi.fn()
    const open = vi.fn()
    toolbarFor = () => ({
      page: { current: 2, total: 5, go },
      wrap: { on: false, toggle },
      find: { open },
      note: '1,248 rows',
    })
    renderViewer()
    expect(await screen.findByText('Page 2 of 5')).toBeInTheDocument()
    expect(screen.getByText('1,248 rows')).toBeInTheDocument()
    const wrap = screen.getByRole('button', { name: 'Wrap lines' })
    expect(wrap).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(wrap)
    expect(toggle).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    expect(open).toHaveBeenCalledOnce()
  })

  it('clears an engine toolbar when moving to another file', async () => {
    toolbarFor = (p) => (p.file.name === 'invoice.pdf' ? { note: 'Two pages here' } : {})
    renderViewer({ files: [invoice, contract] })
    await screen.findByText('Two pages here')
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    await screen.findByText('contract.pdf')
    expect(screen.queryByText('Two pages here')).toBeNull()
  })
})

describe('FileViewer fetching', () => {
  it('fetches through the same-origin proxy, keeping the existing query', async () => {
    renderViewer()
    await screen.findByTestId('engine')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/storage/files/invoice.pdf?read=tok&proxy=1')
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('range')).toBeNull()
  })

  it('keeps a URL fragment after the proxy query, instead of swallowing it', async () => {
    const annotated = file({
      name: 'annotated.pdf',
      family: 'pdf',
      fileId: 'file_annotated',
      url: '/api/storage/files/annotated.pdf?read=tok#page=2',
    })
    renderViewer({ files: [annotated] })
    await screen.findByTestId('engine')
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/storage/files/annotated.pdf?read=tok&proxy=1#page=2'
    )
  })

  it('starts the query when the stored URL has none', async () => {
    renderViewer({ files: [contract] })
    await screen.findByTestId('engine')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/storage/files/contract.pdf?proxy=1')
  })

  it('hands the engine the bytes it fetched', async () => {
    fetchMock.mockImplementation(async () => okBytes(1234))
    renderViewer()
    expect(await screen.findByTestId('engine')).toHaveTextContent(
      'invoice.pdf|1234|false|/api/storage/files/invoice.pdf?read=tok&proxy=1'
    )
  })

  it('reads only the head of a text file and says when it is cut short', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array(TEXT_HEAD_BYTES), {
          status: 206,
          headers: { 'Content-Range': `bytes 0-${TEXT_HEAD_BYTES - 1}/600000` },
        })
    )
    renderViewer({ files: [log] })
    expect(await screen.findByTestId('engine')).toHaveTextContent(
      `import.log|${TEXT_HEAD_BYTES}|true|`
    )
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('range')).toBe(
      `bytes=0-${TEXT_HEAD_BYTES - 1}`
    )
  })

  it('reads a short text file whole', async () => {
    fetchMock.mockImplementation(async () => okBytes(800))
    renderViewer({ files: [{ ...log, size: 800 }] })
    expect(await screen.findByTestId('engine')).toHaveTextContent('import.log|800|false|')
  })

  it('keeps only the head when the server ignores the range', async () => {
    fetchMock.mockImplementation(async () => okBytes(TEXT_HEAD_BYTES + 5000))
    renderViewer({ files: [log] })
    expect(await screen.findByTestId('engine')).toHaveTextContent(
      `import.log|${TEXT_HEAD_BYTES}|true|`
    )
  })

  it('fetches nothing for media and hands the engine a same-origin src', async () => {
    renderViewer({ files: [shot] })
    expect(await screen.findByTestId('engine')).toHaveTextContent(
      'shot.png|none|false|/api/storage/files/shot.png?proxy=1'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows one loading state while the bytes arrive', async () => {
    fetchMock.mockImplementation(pendingUntilAborted)
    renderViewer()
    expect(await screen.findByRole('status', { name: 'Loading file' })).toBeInTheDocument()
    expect(screen.queryByTestId('engine')).toBeNull()
  })

  it('aborts the fetch when moving to another file', async () => {
    fetchMock.mockImplementation(pendingUntilAborted)
    renderViewer({ files: [invoice, contract] })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const first = fetchMock.mock.calls[0]![1]!.signal as AbortSignal
    expect(first.aborted).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    expect(first.aborted).toBe(true)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/storage/files/contract.pdf?proxy=1')
  })

  it('aborts the fetch when the viewer closes', async () => {
    fetchMock.mockImplementation(pendingUntilAborted)
    const { rerender, onClose } = renderViewer()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal
    rerender(
      <IntlProvider locale="en-US" messages={{}}>
        <FileViewer files={[invoice]} index={0} open={false} onClose={onClose} engines={ENGINES} />
      </IntlProvider>
    )
    expect(signal.aborted).toBe(true)
  })

  it('does not let a slow earlier file land on the current one', async () => {
    let resolveFirst: (r: Response) => void = () => {}
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
    )
    fetchMock.mockImplementation(async () => okBytes(42))
    renderViewer({ files: [invoice, contract] })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    expect(await screen.findByTestId('engine')).toHaveTextContent('contract.pdf|42|')
    resolveFirst(okBytes(9999))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByTestId('engine')).toHaveTextContent('contract.pdf|42|')
  })

  it('keeps the bytes in hand when coming straight back to a file', async () => {
    fetchMock.mockImplementationOnce(async () => okBytes(1234))
    fetchMock.mockImplementation(pendingUntilAborted)
    renderViewer({ files: [invoice, contract] })
    expect(await screen.findByTestId('engine')).toHaveTextContent('invoice.pdf|1234|')
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Previous file' }))
    expect(await screen.findByTestId('engine')).toHaveTextContent('invoice.pdf|1234|')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('FileViewer fallback', () => {
  it('offers Download for a format no engine reads', async () => {
    renderViewer({ files: [deck] })
    expect(await screen.findByText('No preview for this file type')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    const links = screen.getAllByRole('link', { name: 'Download' })
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) {
      expect(link).toHaveAttribute(
        'href',
        '/api/storage/files/q4-roadmap.pptx?download=1&filename=q4-roadmap.pptx'
      )
      expect(link).not.toHaveAttribute('download')
    }
  })

  it('says a file is gone when the fetch 404s', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }))
    renderViewer()
    expect(await screen.findByText('This file is no longer available')).toBeInTheDocument()
    expect(screen.queryByTestId('engine')).toBeNull()
  })

  it('refuses to fetch a file over the preview budget', async () => {
    renderViewer({ files: [{ ...invoice, size: 25 * 1024 * 1024 + 1 }] })
    expect(await screen.findByText('Too large to preview')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops a download that turns out larger than the budget', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array(10), {
          status: 200,
          headers: { 'Content-Length': String(30 * 1024 * 1024) },
        })
    )
    renderViewer()
    expect(await screen.findByText('Too large to preview')).toBeInTheDocument()
  })

  it('shows the engine failure it reports', async () => {
    failWith = 'corrupt'
    renderViewer()
    expect(await screen.findByText("This file can't be previewed")).toBeInTheDocument()
  })

  it('says a file is empty when the engine finds nothing in it', async () => {
    failWith = 'empty'
    renderViewer()
    expect(await screen.findByText('This file is empty')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Download' }).length).toBeGreaterThanOrEqual(2)
  })

  it('catches an engine that crashes', async () => {
    throwOnRender = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderViewer()
    expect(await screen.findByText("This file can't be previewed")).toBeInTheDocument()
    error.mockRestore()
  })

  it('shows the next file normally after a failed one', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 404 }))
    renderViewer({ files: [invoice, contract] })
    await screen.findByText('This file is no longer available')
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    expect(await screen.findByTestId('engine')).toHaveTextContent('contract.pdf|1000|')
    expect(screen.queryByText('This file is no longer available')).toBeNull()
  })

  it('shows the fallback translated when the viewer locale is German', async () => {
    renderViewer(
      { files: [deck] },
      {
        locale: 'de',
        messages: {
          'files.viewer.failureUnsupported': 'Keine Vorschau für diesen Dateityp',
          'files.download': 'Herunterladen',
        },
      }
    )
    expect(await screen.findByText('Keine Vorschau für diesen Dateityp')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Herunterladen' }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('FileViewer focus', () => {
  it('focuses the dialog when it opens', async () => {
    renderViewer()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toHaveFocus())
  })

  it('returns focus to the opener when it closes', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'invoice card'
    document.body.appendChild(opener)
    opener.focus()
    const { rerender, onClose } = renderViewer({ opener })
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
    rerender(
      <IntlProvider locale="en-US" messages={{}}>
        <FileViewer
          files={[invoice]}
          index={0}
          open={false}
          opener={opener}
          onClose={onClose}
          engines={ENGINES}
        />
      </IntlProvider>
    )
    await waitFor(() => expect(opener).toHaveFocus())
    opener.remove()
  })
})

describe('FileViewer open beacon', () => {
  it('counts each file once per viewing session', async () => {
    renderViewer({ files: [invoice, contract, deck], index: 0 })
    await screen.findByText('1 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }))
    await waitFor(() => expect(counter()).toBe('2 of 3'))
    expect(beacon.mock.calls.map((c) => c[0])).toEqual([
      '/api/files/opened?fileId=file_invoice',
      '/api/files/opened?fileId=file_contract',
    ])
  })

  it('falls back to a keepalive fetch without sendBeacon', async () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true })
    renderViewer({ files: [deck, { ...deck, key: 'k2', fileId: 'file_deck2' }], index: 1 })
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/files/opened?fileId=file_deck2', {
        method: 'POST',
        keepalive: true,
      })
    )
  })
})

describe('FileViewer compact (widget)', () => {
  it('goes back instead of closing and keeps to the essentials', async () => {
    const set = vi.fn()
    toolbarFor = () => ({ zoom: { value: 1, min: 0.5, max: 2, set }, find: { open: vi.fn() } })
    const { onClose } = renderViewer({ compact: true })
    expect(await screen.findByTestId('engine')).toHaveTextContent('|true')
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Find' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the engine note in a quiet line, so a macro warning is never hidden', async () => {
    toolbarFor = () => ({ note: '1 page · Contains macros' })
    renderViewer({ compact: true })
    expect(await screen.findByText('1 page · Contains macros')).toBeVisible()
  })

  it('pages with a pager under the content', async () => {
    const go = vi.fn()
    toolbarFor = () => ({ page: { current: 3, total: 6, go } })
    renderViewer({ compact: true })
    expect(await screen.findByText('Page 3 of 6')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(go).toHaveBeenLastCalledWith(4)
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(go).toHaveBeenLastCalledWith(2)
  })
})
