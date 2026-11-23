import { memo, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'
import type { BrandImport } from '@/lib/shared/theme/brand-import'
import { importRows } from './brand-apply'
import type { ImportState } from './import-section'

/** A read shorter than this never shows the overlay. */
const SHOW_AFTER_MS = 250
/** The gap between one row filling and the next. */
const ROW_GAP_MS = 180
/** How long the filled card stays before it leaves. */
const HOLD_MS = 1200
/** The card's slide out; matches `import-kit-out` in admin-theme.css. */
const LEAVE_MS = 300

const ROWS = [
  { id: 'logo', label: 'Logo' },
  { id: 'colours', label: 'Colours' },
  { id: 'font', label: 'Font' },
  { id: 'corners', label: 'Corners' },
] as const
type RowId = (typeof ROWS)[number]['id']

/**
 * Where the overlay is in one import: `waiting` out the first moments of a
 * read, `reading` with the sweep and empty rows, `filling` them from the
 * result, then `leaving`.
 */
type Phase = 'hidden' | 'waiting' | 'reading' | 'filling' | 'leaving'

/** The phase a change of import status moves to. A result nobody watched arrive shows nothing. */
function phaseAfter(phase: Phase, status: ImportState['status']): Phase {
  if (status === 'reading') return 'waiting'
  const shown = phase === 'reading' || phase === 'filling'
  if (status === 'done') return shown ? 'filling' : phase === 'leaving' ? 'leaving' : 'hidden'
  return shown || phase === 'leaving' ? 'leaving' : 'hidden'
}

/**
 * The brand kit over the portal preview while Import reads a website: a light
 * sweep and a small card of empty rows, which fill from the result once and
 * then leave. Decoration only: the Import section's status line is what a
 * screen reader hears, and its rows are where the result stays. It renders
 * only when the import's state changes, never with the editor's other edits.
 */
export const ImportOverlay = memo(function ImportOverlay({ state }: { state: ImportState }) {
  const [phase, setPhase] = useState<Phase>('hidden')
  const [filled, setFilled] = useState(0)
  // Follows the status, never the state object: taking a row back gives a new
  // `done` object, which must not play the fill again.
  const [seen, setSeen] = useState<ImportState['status']>('idle')
  const [host, setHost] = useState('')

  if (seen !== state.status) {
    setSeen(state.status)
    const next = phaseAfter(phase, state.status)
    setPhase(next)
    if (next === 'waiting') setFilled(0)
    // The first row fills as the result lands.
    if (next === 'filling') setFilled(1)
    if (state.status === 'reading') setHost(state.host)
  }

  useEffect(() => {
    let delay: number
    let then: () => void
    if (phase === 'waiting') {
      delay = SHOW_AFTER_MS
      then = () => setPhase('reading')
    } else if (phase === 'filling' && filled < ROWS.length) {
      delay = ROW_GAP_MS
      then = () => setFilled(filled + 1)
    } else if (phase === 'filling') {
      delay = HOLD_MS
      then = () => setPhase('leaving')
    } else if (phase === 'leaving') {
      delay = LEAVE_MS
      then = () => setPhase('hidden')
    } else return
    const timer = window.setTimeout(then, delay)
    return () => window.clearTimeout(timer)
  }, [phase, filled])

  if (phase === 'hidden' || phase === 'waiting') return null

  const brand = state.status === 'done' ? state.brand : null
  const found = brand !== null && filled > 0
  const values = brand ? kitValues(brand) : null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {phase === 'reading' ? (
        <div data-testid="import-scan" className="import-scan absolute inset-0" />
      ) : null}
      {found ? <div className="import-reveal absolute inset-0 rounded-[inherit]" /> : null}
      <div
        data-testid="import-kit"
        className={cn(
          'import-kit absolute bottom-3.5 left-3.5 grid w-[min(264px,calc(100%-28px))] gap-1.5',
          'rounded-xl border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg',
          phase === 'leaving' && 'import-kit-leaving'
        )}
      >
        <p className="flex items-baseline gap-2 text-xs font-semibold">
          <span className="min-w-0 truncate">{brand?.host ?? host}</span>
          <span
            className={cn(
              'shrink-0 font-normal text-muted-foreground',
              !found && 'import-kit-dots'
            )}
          >
            {found ? 'Found' : 'Reading the site'}
          </span>
        </p>
        {ROWS.map((row, index) => {
          const value = values && filled > index ? values[row.id] : null
          return (
            <div
              key={row.id}
              className="grid min-h-5 grid-cols-[56px_1fr] items-center gap-2 text-[11.5px] leading-4"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span
                data-testid={`import-kit-${row.id}`}
                data-filled={value !== null}
                className={cn(
                  'min-w-0',
                  value === null ? 'import-kit-slot h-3.5 rounded' : 'import-kit-found'
                )}
              >
                {value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})

const NOT_FOUND = <span className="text-muted-foreground">Not found</span>

/** What each row shows once filled, in the Import section's own words. */
function kitValues(brand: BrandImport): Record<RowId, ReactNode> {
  const rows = importRows(brand)
  const text = (key: 'font' | 'shape') => {
    const row = rows.find((r) => r.key === key)
    return row && row.state !== 'missing' ? row.text : NOT_FOUND
  }
  const colours = [brand.primary, brand.tokens?.header, brand.background, brand.text].filter(
    (c): c is NonNullable<typeof c> => !!c
  )
  return {
    // The logo on the bar it was drawn for: a white one would vanish on the card.
    logo: brand.logo ? (
      <span
        className="inline-flex max-w-full rounded border border-border/70 px-1.5 py-0.5 align-middle"
        style={{ backgroundColor: brand.tokens?.header ?? brand.background }}
      >
        <img src={brand.logo.url} alt="" className="h-4 max-w-full object-contain" />
      </span>
    ) : (
      NOT_FOUND
    ),
    colours:
      colours.length > 0 ? (
        <span className="flex items-center gap-1.5">
          {colours.map((colour, index) => (
            <span
              key={`${index}-${colour}`}
              data-swatch={colour}
              className="import-kit-swatch size-4 rounded border border-foreground/25"
              style={{ backgroundColor: colour, animationDelay: `${index * 80}ms` }}
            />
          ))}
        </span>
      ) : (
        NOT_FOUND
      ),
    font: text('font'),
    corners: text('shape'),
  }
}
