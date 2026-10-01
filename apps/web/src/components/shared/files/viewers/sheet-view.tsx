/**
 * A read-only spreadsheet: a cell bar, a grid virtualized in both directions
 * (only the rows and columns on screen exist in the DOM), and sheet tabs when
 * the workbook has more than one sheet. Every cell is a text node; formulas
 * show as text in the cell bar and are never evaluated. Find uses the shared
 * bar: it searches the sheet on screen and moves the selection to each match.
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useIntl } from 'react-intl'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/shared/utils'
import type { EngineToolbar } from '../types'
import { FindBar } from './find-bar'
import { MAX_FIND_MATCHES } from './find-limit'
import {
  cellAlign,
  cellRef,
  columnLabel,
  columnWidths,
  findCells,
  looksLikeHeader,
  rowsNote,
  type CellAddress,
  type CellRange,
  type SheetData,
} from './sheet-model'

const ROW_HEIGHT = 26
const HEADER_HEIGHT = 24
const ROW_HEADER_WIDTH = 48

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

export function SheetView({
  sheets,
  note,
  onToolbar,
}: {
  sheets: SheetData[]
  /** Said after the row count: "Contains macros". */
  note?: string
  /** Reports the quiet line ("1,248 rows") and find, as an engine does. */
  onToolbar: (toolbar: EngineToolbar) => void
}) {
  const intl = useIntl()
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<CellAddress>({ r: 0, c: 0 })
  const sheet = sheets[active] ?? sheets[0]!
  const gridRef = useRef<HTMLDivElement>(null)

  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => (findOpen ? findCells(sheet, query) : []), [findOpen, sheet, query])
  const matched = useMemo(() => new Set(matches.map((m) => `${m.r}:${m.c}`)), [matches])

  // A new query, or another sheet, starts at the first match.
  useEffect(() => {
    setCurrent(0)
    if (matches[0]) setSelected(matches[0])
  }, [matches])

  const openFind = useCallback(() => {
    setFindOpen(true)
    // Focus after the bar mounts; select so typing replaces the last query.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  function stepMatch(delta: 1 | -1) {
    if (matches.length === 0) return
    const next = (current + delta + matches.length) % matches.length
    setCurrent(next)
    setSelected(matches[next]!)
  }

  function closeFind() {
    setFindOpen(false)
    gridRef.current?.focus()
  }

  const report = useEffectEvent(onToolbar)
  useEffect(() => {
    const rows = rowsNote(sheet, intl)
    report({ note: note ? `${rows} · ${note}` : rows, find: { open: openFind } })
  }, [sheet, intl, note, openFind])

  function showSheet(index: number) {
    setActive(index)
    setSelected({ r: 0, c: 0 })
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {findOpen && (
        <FindBar
          inputRef={inputRef}
          query={query}
          onQueryChange={setQuery}
          current={matches.length > 0 ? current : -1}
          total={matches.length}
          capped={matches.length >= MAX_FIND_MATCHES}
          onStep={stepMatch}
          onClose={closeFind}
        />
      )}
      <CellBar sheet={sheet} selected={selected} />
      <SheetGrid
        key={active}
        gridRef={gridRef}
        sheet={sheet}
        selected={selected}
        matched={matched}
        onSelect={setSelected}
      />
      {sheets.length > 1 && <SheetTabs sheets={sheets} active={active} onChange={showSheet} />}
    </div>
  )
}

function CellBar({ sheet, selected }: { sheet: SheetData; selected: CellAddress }) {
  const ref = cellRef(selected.r, selected.c)
  const formula = sheet.formulas[ref]
  const value = sheet.rows[selected.r]?.[selected.c] ?? ''
  return (
    <div
      data-testid="cell-bar"
      className="flex min-h-8 shrink-0 items-stretch border-b border-border/60 text-[12.5px]"
    >
      <span className="grid w-16 shrink-0 place-items-center border-r border-border/60 font-semibold tabular-nums">
        {ref}
      </span>
      <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap px-2.5">
        <i aria-hidden="true" className="font-serif text-muted-foreground">
          fx
        </i>
        {formula ? (
          <code className="truncate font-mono text-xs">{formula}</code>
        ) : (
          <span className="truncate">{value}</span>
        )}
      </span>
    </div>
  )
}

function SheetGrid({
  gridRef: scrollRef,
  sheet,
  selected,
  matched,
  onSelect,
}: {
  gridRef: RefObject<HTMLDivElement | null>
  sheet: SheetData
  selected: CellAddress
  /** Find's matches, as "row:column". */
  matched: ReadonlySet<string>
  onSelect: (cell: CellAddress) => void
}) {
  const rowCount = sheet.rows.length
  const colCount = sheet.colCount
  const widths = useMemo(() => columnWidths(sheet), [sheet])
  const header = useMemo(() => looksLikeHeader(sheet), [sheet])
  const merges = useMemo(() => mergeBoxes(sheet, widths), [sheet, widths])

  const rows = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    overscan: 10,
  })
  const cols = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => widths[index] ?? 64,
    paddingStart: ROW_HEADER_WIDTH,
    scrollPaddingStart: ROW_HEADER_WIDTH,
    overscan: 4,
  })

  const totalWidth = cols.getTotalSize()
  const totalHeight = rows.getTotalSize()
  const visibleCols = cols.getVirtualItems()
  const visibleRows = rows.getVirtualItems()
  // Only merges that reach the rows on screen are consulted while drawing.
  const firstRow = visibleRows[0]?.index ?? 0
  const lastRow = visibleRows[visibleRows.length - 1]?.index ?? -1
  const mergesInView = merges.filter((m) => m.e.r >= firstRow && m.s.r <= lastRow)

  // The selected cell stays in view, whether the arrows or find moved it.
  useEffect(() => {
    if (selected.r < rowCount) rows.scrollToIndex(selected.r)
    if (selected.c < colCount) cols.scrollToIndex(selected.c)
  }, [selected, rowCount, colCount, rows, cols])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = ARROWS[event.key]
    if (!step || rowCount === 0 || colCount === 0) return
    event.preventDefault()
    // The grid uses the arrows; the gallery must not move.
    event.stopPropagation()
    const r = Math.min(rowCount - 1, Math.max(0, selected.r + step[0]))
    const c = Math.min(colCount - 1, Math.max(0, selected.c + step[1]))
    onSelect({ r, c })
  }

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-readonly="true"
      aria-label={sheet.name}
      aria-rowcount={rowCount + 1}
      aria-colcount={colCount + 1}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-auto bg-background text-[12.5px] tabular-nums outline-none"
    >
      <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-20"
          style={{ width: totalWidth, height: HEADER_HEIGHT }}
        >
          <div
            aria-hidden="true"
            className="sticky left-0 z-30 border-b border-r border-border/60 bg-muted"
            style={{ width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }}
          />
          {visibleCols.map((col) => (
            <div
              key={col.key}
              role="columnheader"
              aria-colindex={col.index + 2}
              className="absolute top-0 grid place-items-center border-b border-r border-border/60 bg-muted text-[11.5px] font-medium text-muted-foreground"
              style={{ left: col.start, width: col.size, height: HEADER_HEIGHT }}
            >
              {columnLabel(col.index)}
            </div>
          ))}
        </div>
        {visibleRows.map((row) => {
          const values = sheet.rows[row.index] ?? []
          const kinds = sheet.types[row.index] ?? ''
          const isHeader = header && row.index === 0
          return (
            <div
              key={row.key}
              role="row"
              aria-rowindex={row.index + 2}
              data-header-row={isHeader ? 'true' : undefined}
              className="absolute left-0"
              style={{ top: row.start, width: totalWidth, height: row.size }}
            >
              <div
                role="rowheader"
                className="sticky left-0 z-10 grid place-items-center border-b border-r border-border/60 bg-muted text-[11.5px] font-medium text-muted-foreground"
                style={{ width: ROW_HEADER_WIDTH, height: row.size }}
              >
                {row.index + 1}
              </div>
              {visibleCols.map((col) => {
                const merge = mergeAt(mergesInView, row.index, col.index)
                // A merged range draws once, from its first cell.
                if (merge && (merge.s.r !== row.index || merge.s.c !== col.index)) return null
                const span = merge
                const isSelected = selected.r === row.index && selected.c === col.index
                const isMatch = matched.has(`${row.index}:${col.index}`)
                const align = cellAlign(kinds[col.index])
                return (
                  <div
                    key={col.key}
                    role="gridcell"
                    aria-colindex={col.index + 2}
                    aria-selected={isSelected}
                    data-cell={cellRef(row.index, col.index)}
                    data-match={isMatch ? '' : undefined}
                    onClick={() => onSelect({ r: row.index, c: col.index })}
                    className={cn(
                      'absolute top-0 cursor-cell truncate border-b border-r border-border/60 px-2 leading-[25px]',
                      align === 'right' && 'text-right',
                      align === 'center' && 'text-center',
                      isHeader && 'bg-muted/50 font-semibold',
                      span && 'z-[1] bg-background',
                      isMatch && 'bg-amber-200/60 dark:bg-amber-400/25',
                      isSelected &&
                        'z-[2] outline outline-2 -outline-offset-2 outline-green-700 dark:outline-green-500'
                    )}
                    style={{
                      left: col.start,
                      width: span?.width ?? col.size,
                      height: span?.height ?? row.size,
                    }}
                  >
                    {values[col.index] ?? ''}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface MergeBox extends CellRange {
  width: number
  height: number
}

/**
 * Each merged range with the size its first cell spans. One entry per range,
 * whatever its area, so a merge over a whole sheet costs no more than one
 * over two cells.
 */
function mergeBoxes(sheet: SheetData, widths: number[]): MergeBox[] {
  return sheet.merges.map((m) => {
    let width = 0
    for (let c = m.s.c; c <= m.e.c; c++) width += widths[c] ?? 0
    return { ...m, width, height: (m.e.r - m.s.r + 1) * ROW_HEIGHT }
  })
}

function mergeAt(merges: readonly MergeBox[], r: number, c: number): MergeBox | undefined {
  return merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c)
}

function SheetTabs({
  sheets,
  active,
  onChange,
}: {
  sheets: SheetData[]
  active: number
  onChange: (index: number) => void
}) {
  const intl = useIntl()
  const listRef = useRef<HTMLDivElement>(null)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    event.stopPropagation()
    const next = (active + step + sheets.length) % sheets.length
    onChange(next)
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={intl.formatMessage({ id: 'files.sheet.tabsAria', defaultMessage: 'Sheets' })}
      onKeyDown={onKeyDown}
      className="flex min-h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-t border-border/60 bg-background px-2"
    >
      {sheets.map((s, index) => {
        const isActive = index === active
        return (
          <button
            key={`${index}:${s.name}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(index)}
            className={cn(
              '-mt-px cursor-pointer whitespace-nowrap border-t-2 border-transparent px-3 py-[7px] text-[12.5px] text-muted-foreground hover:text-foreground',
              isActive && 'border-green-700 font-semibold text-foreground dark:border-green-500'
            )}
          >
            {s.name}
          </button>
        )
      })}
    </div>
  )
}
