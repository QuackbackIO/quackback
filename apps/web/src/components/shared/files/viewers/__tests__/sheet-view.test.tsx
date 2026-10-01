// @vitest-environment happy-dom
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
import { SheetView } from '../sheet-view'
import type { EngineToolbar } from '../../types'
import { columnWidths, type SheetData } from '../sheet-model'
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
  restoreLayout = withLayoutSize(1200, 700)
})
afterEach(() => {
  cleanup()
  restoreLayout()
})

function sheet(name: string, rows: string[][], extra: Partial<SheetData> = {}): SheetData {
  const colCount = Math.max(...rows.map((r) => r.length))
  return {
    name,
    rows,
    types: rows.map((r) =>
      r.map((v) => (v === '' ? ' ' : /^-?[\d.,]+$/.test(v) ? 'n' : 's')).join('')
    ),
    formulas: {},
    merges: [],
    colCount,
    totalRows: rows.length,
    rowsTruncated: false,
    columnsTruncated: false,
    ...extra,
  }
}

const invoice = sheet(
  'Invoice',
  [
    ['Item', 'Amount', 'Note'],
    ['Seats', '1,234.50', '<b>bold?</b>'],
    ['Support', '99.00', 'https://example.com'],
    ['Total', '1,333.50', ''],
  ],
  { formulas: { B4: '=SUM(B2:B3)' } }
)

function cell(ref: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-cell="${ref}"]`)
  if (!el) throw new Error(`no cell ${ref}`)
  return el
}

function cellBar(): HTMLElement {
  return screen.getByTestId('cell-bar')
}

function lastToolbar(onToolbar: { mock: { calls: [EngineToolbar][] } }): EngineToolbar {
  const calls = onToolbar.mock.calls
  if (calls.length === 0) throw new Error('no toolbar reported')
  return calls[calls.length - 1]![0]
}

describe('SheetView', () => {
  it('lays the sheet out with column letters, row numbers and cell text', () => {
    render(<SheetView sheets={[invoice]} onToolbar={() => {}} />)
    const grid = screen.getByRole('grid')
    expect(within(grid).getByRole('columnheader', { name: 'A' })).toBeInTheDocument()
    expect(within(grid).getByRole('columnheader', { name: 'C' })).toBeInTheDocument()
    expect(within(grid).getByRole('rowheader', { name: '4' })).toBeInTheDocument()
    expect(cell('A2')).toHaveTextContent('Seats')
    expect(cell('B4')).toHaveTextContent('1,333.50')
  })

  it('shows cell content as text, never as markup or links', () => {
    render(<SheetView sheets={[invoice]} onToolbar={() => {}} />)
    expect(cell('C2')).toHaveTextContent('<b>bold?</b>')
    expect(cell('C2').querySelector('b')).toBeNull()
    expect(cell('C3').querySelector('a')).toBeNull()
  })

  it('right-aligns numbers and styles a header row', () => {
    render(<SheetView sheets={[invoice]} onToolbar={() => {}} />)
    expect(cell('B2').className).toContain('text-right')
    expect(cell('A2').className).not.toContain('text-right')
    expect(cell('A1').closest('[role="row"]')).toHaveAttribute('data-header-row', 'true')
    expect(cell('A2').closest('[role="row"]')).not.toHaveAttribute('data-header-row')
  })

  it('does not style a header when the first row holds data', () => {
    const data = sheet('Data', [
      ['1', '2'],
      ['3', '4'],
    ])
    render(<SheetView sheets={[data]} onToolbar={() => {}} />)
    expect(cell('A1').closest('[role="row"]')).not.toHaveAttribute('data-header-row')
  })

  it('shows the selected cell in the cell bar, with formulas as text', () => {
    render(<SheetView sheets={[invoice]} onToolbar={() => {}} />)
    expect(cellBar()).toHaveTextContent('A1')
    expect(cellBar()).toHaveTextContent('Item')

    fireEvent.click(cell('B4'))
    expect(cell('B4')).toHaveAttribute('aria-selected', 'true')
    expect(cellBar()).toHaveTextContent('B4')
    expect(within(cellBar()).getByText('=SUM(B2:B3)').tagName).toBe('CODE')

    fireEvent.click(cell('A3'))
    expect(cellBar()).toHaveTextContent('A3')
    expect(cellBar()).toHaveTextContent('Support')
    expect(cellBar().querySelector('code')).toBeNull()
  })

  it('moves the selection with the arrow keys, inside the sheet', () => {
    render(<SheetView sheets={[invoice]} onToolbar={() => {}} />)
    const grid = screen.getByRole('grid')
    const outside = vi.fn()
    document.addEventListener('keydown', outside)
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(cellBar()).toHaveTextContent('B2')
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    expect(cellBar()).toHaveTextContent('A1')
    // The gallery's own Left/Right never sees keys the grid used.
    expect(outside).not.toHaveBeenCalled()
    document.removeEventListener('keydown', outside)
  })

  it('finds cell text and moves the selection through the matches, as find does elsewhere', async () => {
    const onToolbar = vi.fn<(toolbar: EngineToolbar) => void>()
    render(<SheetView sheets={[invoice]} onToolbar={onToolbar} />)
    act(() => lastToolbar(onToolbar).find!.open())
    const input = await screen.findByRole('searchbox', { name: 'Find in file' })
    await waitFor(() => expect(input).toHaveFocus())

    // Display text, any case, in reading order: B1, C1, C2, A3, C3, A4.
    fireEvent.change(input, { target: { value: 'O' } })
    expect(screen.getByText('1 of 6')).toBeInTheDocument()
    expect(cellBar()).toHaveTextContent('B1')
    expect(cell('B1')).toHaveAttribute('aria-selected', 'true')
    expect(cell('B1')).toHaveAttribute('data-match')
    expect(cell('A1')).not.toHaveAttribute('data-match')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2 of 6')).toBeInTheDocument()
    expect(cellBar()).toHaveTextContent('C1')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('6 of 6')).toBeInTheDocument()
    expect(cellBar()).toHaveTextContent('A4')

    fireEvent.change(input, { target: { value: 'nothing like it' } })
    expect(screen.getByText('No matches')).toBeInTheDocument()

    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByRole('grid')).toHaveFocus()
  })

  it('searches the sheet on screen, and starts over on another sheet', async () => {
    const onToolbar = vi.fn<(toolbar: EngineToolbar) => void>()
    const other = sheet('Redirects', [
      ['From', 'To'],
      ['/total', '/sum'],
    ])
    render(<SheetView sheets={[invoice, other]} onToolbar={onToolbar} />)
    act(() => lastToolbar(onToolbar).find!.open())
    const input = await screen.findByRole('searchbox', { name: 'Find in file' })
    fireEvent.change(input, { target: { value: 'total' } })
    expect(screen.getByText('1 of 1')).toBeInTheDocument()
    expect(cellBar()).toHaveTextContent('A4')

    fireEvent.click(within(screen.getByRole('tablist')).getAllByRole('tab')[1]!)
    expect(screen.getByText('1 of 1')).toBeInTheDocument()
    expect(cellBar()).toHaveTextContent('A2')
  })

  it('has no sheet tabs for a single sheet', () => {
    render(<SheetView sheets={[invoice]} onToolbar={() => {}} />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('switches sheets from tabs and reports each sheet’s row count', () => {
    const onToolbar = vi.fn<(toolbar: EngineToolbar) => void>()
    const big = sheet('Articles', [['Title'], ['One']], { totalRows: 9000, rowsTruncated: true })
    const small = sheet(
      'Redirects',
      [
        ['From', 'To'],
        ['/a', '/b'],
      ],
      { totalRows: 1248 }
    )
    render(<SheetView sheets={[invoice, big, small]} onToolbar={onToolbar} />)

    const tabs = within(screen.getByRole('tablist', { name: 'Sheets' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Invoice', 'Articles', 'Redirects'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(lastToolbar(onToolbar).note).toBe('4 rows')

    fireEvent.click(tabs[1]!)
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(cell('A2')).toHaveTextContent('One')
    expect(lastToolbar(onToolbar).note).toBe('First 2,000 rows')

    fireEvent.click(tabs[2]!)
    expect(cell('B2')).toHaveTextContent('/b')
    expect(lastToolbar(onToolbar).note).toBe('1,248 rows')
  })

  it('draws a merged range as one cell over the cells it covers', () => {
    const merged = sheet(
      'Merged',
      [
        ['Quarterly summary', '', ''],
        ['a', 'b', 'c'],
      ],
      { merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] }
    )
    render(<SheetView sheets={[merged]} onToolbar={() => {}} />)
    expect(cell('A1')).toHaveTextContent('Quarterly summary')
    const [a, b, c] = columnWidths(merged)
    expect(cell('A1').style.width).toBe(`${a! + b! + c!}px`)
    expect(document.querySelector('[data-cell="B1"]')).toBeNull()
    expect(document.querySelector('[data-cell="C1"]')).toBeNull()
    expect(cell('B2')).toHaveTextContent('b')
  })

  it('draws a row that stops before the last column', () => {
    const ragged = sheet('Ragged', [['a', 'b', 'c'], ['d']])
    render(<SheetView sheets={[ragged]} onToolbar={() => {}} />)
    expect(cell('C2')).toHaveTextContent('')
    fireEvent.click(cell('C2'))
    expect(cellBar()).toHaveTextContent('C2')
  })

  it('renders an empty sheet without failing', () => {
    render(<SheetView sheets={[sheet('Empty', [[]])]} onToolbar={() => {}} />)
    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  it('reports the row count and the tabs aria-label in German', () => {
    const onToolbar = vi.fn<(toolbar: EngineToolbar) => void>()
    const small = sheet(
      'Redirects',
      [
        ['From', 'To'],
        ['/a', '/b'],
      ],
      { totalRows: 1248 }
    )
    rtlRender(
      <IntlProvider
        locale="de"
        messages={{
          'files.count.rows': '{count, plural, one {# Zeile} other {# Zeilen}}',
          'files.sheet.tabsAria': 'Tabellenblätter',
        }}
      >
        <SheetView sheets={[invoice, small]} onToolbar={onToolbar} />
      </IntlProvider>
    )
    expect(screen.getByRole('tablist', { name: 'Tabellenblätter' })).toBeInTheDocument()
    expect(lastToolbar(onToolbar).note).toBe('4 Zeilen')

    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    fireEvent.click(tabs[1]!)
    expect(lastToolbar(onToolbar).note).toBe('1.248 Zeilen')
  })
})
