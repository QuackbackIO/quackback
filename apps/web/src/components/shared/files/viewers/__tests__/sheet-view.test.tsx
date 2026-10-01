// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { SheetView } from '../sheet-view'
import type { SheetData } from '../sheet-model'
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
    truncated: false,
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

describe('SheetView', () => {
  it('lays the sheet out with column letters, row numbers and cell text', () => {
    render(<SheetView sheets={[invoice]} onNote={() => {}} />)
    const grid = screen.getByRole('grid')
    expect(within(grid).getByRole('columnheader', { name: 'A' })).toBeInTheDocument()
    expect(within(grid).getByRole('columnheader', { name: 'C' })).toBeInTheDocument()
    expect(within(grid).getByRole('rowheader', { name: '4' })).toBeInTheDocument()
    expect(cell('A2')).toHaveTextContent('Seats')
    expect(cell('B4')).toHaveTextContent('1,333.50')
  })

  it('shows cell content as text, never as markup or links', () => {
    render(<SheetView sheets={[invoice]} onNote={() => {}} />)
    expect(cell('C2')).toHaveTextContent('<b>bold?</b>')
    expect(cell('C2').querySelector('b')).toBeNull()
    expect(cell('C3').querySelector('a')).toBeNull()
  })

  it('right-aligns numbers and styles a header row', () => {
    render(<SheetView sheets={[invoice]} onNote={() => {}} />)
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
    render(<SheetView sheets={[data]} onNote={() => {}} />)
    expect(cell('A1').closest('[role="row"]')).not.toHaveAttribute('data-header-row')
  })

  it('shows the selected cell in the cell bar, with formulas as text', () => {
    render(<SheetView sheets={[invoice]} onNote={() => {}} />)
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
    render(<SheetView sheets={[invoice]} onNote={() => {}} />)
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

  it('has no sheet tabs for a single sheet', () => {
    render(<SheetView sheets={[invoice]} onNote={() => {}} />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('switches sheets from tabs and reports each sheet’s row count', () => {
    const onNote = vi.fn()
    const big = sheet('Articles', [['Title'], ['One']], { totalRows: 9000, truncated: true })
    const small = sheet(
      'Redirects',
      [
        ['From', 'To'],
        ['/a', '/b'],
      ],
      { totalRows: 1248 }
    )
    render(<SheetView sheets={[invoice, big, small]} onNote={onNote} />)

    const tabs = within(screen.getByRole('tablist', { name: 'Sheets' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Invoice', 'Articles', 'Redirects'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(onNote).toHaveBeenLastCalledWith('4 rows')

    fireEvent.click(tabs[1]!)
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(cell('A2')).toHaveTextContent('One')
    expect(onNote).toHaveBeenLastCalledWith('First 5,000 rows')

    fireEvent.click(tabs[2]!)
    expect(cell('B2')).toHaveTextContent('/b')
    expect(onNote).toHaveBeenLastCalledWith('1,248 rows')
  })

  it('renders an empty sheet without failing', () => {
    render(<SheetView sheets={[sheet('Empty', [[]])]} onNote={() => {}} />)
    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  it('reports the row count and the tabs aria-label in German', () => {
    const onNote = vi.fn()
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
        <SheetView sheets={[invoice, small]} onNote={onNote} />
      </IntlProvider>
    )
    expect(screen.getByRole('tablist', { name: 'Tabellenblätter' })).toBeInTheDocument()
    expect(onNote).toHaveBeenLastCalledWith('4 Zeilen')

    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    fireEvent.click(tabs[1]!)
    expect(onNote).toHaveBeenLastCalledWith('1.248 Zeilen')
  })
})
