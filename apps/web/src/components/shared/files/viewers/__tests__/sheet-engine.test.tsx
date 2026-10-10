// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import * as XLSX from 'xlsx'
import { strToU8 } from 'fflate'
import type { ViewerEngineProps, ViewerFile } from '../../types'
import { handleSheetRequest, type SheetRequest } from '../sheet-parse'
import { withLayoutSize } from './layout-size'

function render(node: React.ReactNode) {
  return rtlRender(
    <IntlProvider locale="en-US" messages={{}}>
      {node}
    </IntlProvider>
  )
}

/**
 * Stands in for the browser Worker: the same message protocol, answered by
 * the real parsing code on a later task, as a worker thread would.
 */
class InProcessWorker {
  static instances: InProcessWorker[] = []
  static hang = false
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminated = false
  received: SheetRequest[] = []
  transferred: Transferable[] = []

  constructor() {
    InProcessWorker.instances.push(this)
  }

  postMessage(message: SheetRequest, transfer: Transferable[] = []) {
    this.received.push(message)
    this.transferred.push(...transfer)
    if (InProcessWorker.hang) return
    setTimeout(() => {
      if (this.terminated) return
      this.onmessage?.(new MessageEvent('message', { data: handleSheetRequest(message) }))
    }, 0)
  }

  terminate() {
    this.terminated = true
  }
}

vi.mock('../sheet-worker-client', () => ({
  createSheetWorker: () => new InProcessWorker(),
}))

const { default: SheetEngine } = await import('../sheet-engine')

let restoreLayout: () => void
beforeEach(() => {
  InProcessWorker.instances = []
  InProcessWorker.hang = false
  restoreLayout = withLayoutSize(1200, 700)
})
afterEach(() => {
  cleanup()
  restoreLayout()
  vi.useRealTimers()
})

function file(name: string, extra: Partial<ViewerFile> = {}): ViewerFile {
  return {
    key: name,
    url: `/api/storage/files/${name}`,
    name,
    contentType: '',
    size: 1,
    family: 'spreadsheet',
    ...extra,
  }
}

function props(name: string, data: ArrayBuffer, overrides: Partial<ViewerEngineProps> = {}) {
  return {
    file: file(name),
    data,
    truncated: false,
    src: '',
    onToolbar: vi.fn(),
    onError: vi.fn(),
    compact: false,
    ...overrides,
  } satisfies ViewerEngineProps
}

function workbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Name', 'Seats'],
      ['Acme', 12],
      ['Globex', 40],
    ]),
    'Customers'
  )
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('SheetEngine', () => {
  it('parses off the page and shows the grid with a row count', async () => {
    const p = props('customers.xlsx', workbook())
    const { container } = render(<SheetEngine {...p} />)
    await waitFor(() =>
      expect(container.querySelector('[data-cell="A2"]')).toHaveTextContent('Acme')
    )
    expect(p.onToolbar).toHaveBeenLastCalledWith({
      note: '3 rows',
      find: { open: expect.any(Function) },
    })
    expect(p.onError).not.toHaveBeenCalled()
    const [worker] = InProcessWorker.instances
    expect(worker!.received[0]!.source).toBe('workbook')
  })

  it('sends the worker a copy, leaving the viewer’s bytes intact', async () => {
    const data = workbook()
    const size = data.byteLength
    render(<SheetEngine {...props('customers.xlsx', data)} />)
    const [worker] = InProcessWorker.instances
    expect(worker!.transferred).toHaveLength(1)
    expect(worker!.transferred[0]).not.toBe(data)
    expect(data.byteLength).toBe(size)
  })

  it.each([
    ['a macro-enabled extension', file('budget.xlsm')],
    [
      'a macro-enabled type',
      file('budget', { contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12' }),
    ],
    ['the preview job finding macros', file('budget.xls', { preview: { macro: true } })],
  ])('notes macros for %s, beside the row count', async (_, f) => {
    const p = { ...props(f.name, workbook()), file: f }
    const { container } = render(<SheetEngine {...p} />)
    await waitFor(() => expect(container.querySelector('[data-cell="A2"]')).not.toBeNull())
    expect(p.onToolbar).toHaveBeenLastCalledWith(
      expect.objectContaining({ note: '3 rows · Contains macros' })
    )
  })

  it('reads CSV through the delimited-text parser', async () => {
    const p = props('export.csv', strToU8('id,name\n1,Acme\n').buffer as ArrayBuffer)
    const { container } = render(<SheetEngine {...p} />)
    await waitFor(() =>
      expect(container.querySelector('[data-cell="B2"]')).toHaveTextContent('Acme')
    )
    expect(InProcessWorker.instances[0]!.received[0]!.source).toBe('csv')
    expect(p.onToolbar).toHaveBeenLastCalledWith(expect.objectContaining({ note: '2 rows' }))
  })

  it('shows the viewer’s loading state while the worker parses', async () => {
    InProcessWorker.hang = true
    render(<SheetEngine {...props('customers.xlsx', workbook())} />)
    expect(screen.getByRole('status', { name: 'Loading file' })).toBeInTheDocument()
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('reports a workbook with no cells as empty instead of a blank grid', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Sheet1')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Sheet2')
    const p = props('blank.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    render(<SheetEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('empty'))
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('reports an empty CSV as empty', async () => {
    const p = props('export.csv', new ArrayBuffer(0))
    render(<SheetEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('empty'))
  })

  it('reports a damaged workbook as corrupt', async () => {
    const p = props('broken.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer)
    render(<SheetEngine {...p} />)
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith('corrupt'))
    expect(InProcessWorker.instances[0]!.terminated).toBe(true)
  })

  it('gives up after 15 seconds, stops the worker and reports the file as too large', async () => {
    vi.useFakeTimers()
    InProcessWorker.hang = true
    const p = props('huge.xlsx', workbook())
    render(<SheetEngine {...p} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999)
    })
    expect(p.onError).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(p.onError).toHaveBeenCalledWith('too_large')
    expect(InProcessWorker.instances[0]!.terminated).toBe(true)
  })

  it('stops the worker when the viewer moves on', () => {
    InProcessWorker.hang = true
    const { unmount } = render(<SheetEngine {...props('customers.xlsx', workbook())} />)
    const [worker] = InProcessWorker.instances
    expect(worker!.terminated).toBe(false)
    unmount()
    expect(worker!.terminated).toBe(true)
  })
})
