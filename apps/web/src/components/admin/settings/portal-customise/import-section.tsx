import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { ArrowUturnLeftIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/shared/utils'
import { importBrandFn } from '@/lib/server/functions/portal-customise'
import { track } from '@/lib/client/analytics'
import { errorText } from '@/lib/client/error-text'
import { loadBrandingFont } from '@/lib/client/hooks/use-branding-font'
import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import { BRAND_READER_NAME } from '@/lib/shared/theme/brand-import'
import type { BrandAsset, BrandImport, SiteNotRead } from '@/lib/shared/theme/brand-import'
import {
  applySuggestion,
  dropAsset,
  importSuggestions,
  replaceImport,
  importRows,
  revertImport,
  stillApplied,
  stillUndone,
  takeBackRow,
  ASSET_ROW,
  type ImportRow,
  type ImportRowKey,
  type ImportSuggestion,
  type SuggestionKey,
} from './brand-apply'
import type { PortalDraft } from './portal-draft'

type DoneImport = Extract<ImportState, { status: 'done' }>

export type ImportState =
  | { status: 'idle' }
  | { status: 'reading'; host: string }
  | {
      status: 'refused'
      message: string
      /** What the site showed in its own page's place, when that is why. */
      notRead?: SiteNotRead
      /** The address that was tried, for Try again. */
      input?: string
    }
  | {
      status: 'done'
      host: string
      brand: BrandImport
      /** The draft before the import, which each row's Undo takes its values from. */
      before: PortalDraft
      /**
       * Rows taken back since and still taken back: the hook reads them
       * against the draft, so one the editor's undo brought back is in again.
       */
      undone: ImportRowKey[]
    }

/** The host a typed address names, for the reading line. */
function hostOf(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./i, '')
    .toLowerCase()
}

/** The closed section's value. */
export function importSummary(state: ImportState): string {
  if (state.status === 'reading') return 'Reading…'
  if (state.status === 'done') return `From ${state.host}`
  return 'From your website'
}

/**
 * A finished import in one line: where from, and how much is in the draft.
 * The section's status says it, and so does the chat's reply to an import it started.
 */
export function importStatusLine(state: Extract<ImportState, { status: 'done' }>): string {
  const applied = importRows(state.brand).filter((row) => stillApplied(row, state.undone)).length
  return `From ${state.host} · ${applied === 0 ? 'nothing applied' : `${applied} applied`}`
}

/** The last import in one line, for the chat's reply to an import it started. */
export interface ImportBrief {
  status: 'reading' | 'done' | 'refused'
  host: string
  line: string
}

export function importBrief(state: ImportState): ImportBrief | null {
  switch (state.status) {
    case 'reading':
      return { status: 'reading', host: state.host, line: `Reading ${state.host}…` }
    case 'done':
      return { status: 'done', host: state.host, line: importStatusLine(state) }
    case 'refused':
      return {
        status: 'refused',
        host: state.notRead?.host ?? '',
        line: state.notRead
          ? `${state.notRead.host} could not be read. Nothing changed.`
          : state.message,
      }
    default:
      return null
  }
}

/**
 * Import your brand: reads a website and puts what it found in the draft as
 * one step. Each result row can be taken back on its own, as its own step,
 * and the whole import in one.
 */
export function useBrandImport({
  update,
  getDraft,
  onSuggestionUsed,
}: {
  update: (edit: (draft: PortalDraft) => PortalDraft) => void
  getDraft: () => PortalDraft
  /** A suggestion was used: the draft before and after, for the reply with its Undo. */
  onSuggestionUsed?: (before: PortalDraft, after: PortalDraft) => void
}) {
  const [kept, setKept] = useState<ImportState>({ status: 'idle' })
  // The last finished import, kept while another is read or refused: its
  // assets stay in the draft, so Publish still asks about them, and the
  // next import still replaces it.
  const [last, setLast] = useState<DoneImport | null>(null)
  const setState = useCallback((next: ImportState) => {
    setKept(next)
    if (next.status === 'done') setLast(next)
  }, [])
  // Which rows are taken back is read from the draft: an editor undo of a row's Undo brings it back.
  const undone = kept.status === 'done' ? stillUndone(getDraft(), kept.before, kept.undone) : []
  const undoneKey = undone.join(' ')
  // One identity while nothing it says changes: the chat's reply follows it.
  const state = useMemo<ImportState>(
    () =>
      kept.status === 'done'
        ? { ...kept, undone: undoneKey ? (undoneKey.split(' ') as ImportRowKey[]) : [] }
        : kept,
    [kept, undoneKey]
  )

  const run = useCallback(
    async (input: string) => {
      setState({ status: 'reading', host: hostOf(input) || input.trim() })
      try {
        const result = await importBrandFn({ data: { url: input.trim() } })
        if (!result.ok) {
          void track('portal_brand_import', { ok: false, reader: null, missing: [] })
          setState({
            status: 'refused',
            message: result.message,
            ...(result.notRead ? { notRead: result.notRead, input: input.trim() } : {}),
          })
          return
        }
        const { brand } = result
        void track('portal_brand_import', {
          ok: true,
          reader: brand.reader,
          missing: brand.missing,
        })
        // It takes the place of the last import, never stacks on it.
        const previous =
          state.status === 'done'
            ? state
            : last && { ...last, undone: stillUndone(getDraft(), last.before, last.undone) }
        const { before, next } = replaceImport(getDraft(), previous, brand)
        update(() => next)
        setState({ status: 'done', host: brand.host, brand, before, undone: [] })
      } catch (error) {
        void track('portal_brand_import', { ok: false, reader: null, missing: [] })
        setState({
          status: 'refused',
          message: errorText(error, "Couldn't import that website. Try again."),
        })
      }
    },
    [update, getDraft, state, last, setState]
  )

  const undoRow = useCallback(
    (key: ImportRowKey) => {
      if (state.status !== 'done') return
      const { before, brand } = state
      // A row taken back already has nothing left to take back.
      const row = importRows(brand).find((r) => r.key === key)
      if (!row || !stillApplied(row, state.undone)) return
      update((draft) => takeBackRow(draft, before, brand, key))
      setState({ ...state, undone: [...state.undone, key] })
    },
    [state, update, setState]
  )

  /** Everything the import put in the draft, taken back as one step. The results stay listed. */
  const undoAll = useCallback(() => {
    if (state.status !== 'done') return
    const keys = importRows(state.brand)
      .filter((row) => stillApplied(row, state.undone))
      .map((row) => row.key)
    if (keys.length === 0) return
    update((draft) => revertImport(draft, state))
    setState({ ...state, undone: [...state.undone, ...keys] })
  }, [state, update, setState])

  /**
   * Brand assets the person would not confirm at Publish, taken back as one
   * step. Returns the draft without them, for the publish that follows at
   * once, before the editor renders it.
   */
  const dropAssets = useCallback(
    (assets: readonly BrandAsset[]): PortalDraft => {
      const draft = getDraft()
      // The import Publish asked about: the one on show, or the last finished one.
      const from = state.status === 'done' ? state : last
      if (!from || assets.length === 0) return draft
      const { before, brand } = from
      const next = assets.reduce((d, asset) => dropAsset(d, before, brand, asset), draft)
      if (next === draft) return draft
      update(() => next)
      const rows = assets.map((asset) => ASSET_ROW[asset])
      const undone = [...new Set([...from.undone, ...rows])]
      if (state.status === 'done') setState({ ...state, undone })
      else setLast({ ...from, undone })
      return next
    },
    [state, last, getDraft, update, setState]
  )

  // The words the import suggests; which are in use is read from the draft, as the assets are.
  const suggestions =
    state.status === 'done' ? importSuggestions(state.brand, state.before, getDraft()) : []

  /** Use one suggested word: one step in the draft, never without this click. */
  const useSuggestion = useCallback(
    (key: SuggestionKey) => {
      if (state.status !== 'done') return
      const before = getDraft()
      const after = applySuggestion(before, state.brand, key)
      if (after === before) return
      update(() => after)
      onSuggestionUsed?.(before, after)
    },
    [state, getDraft, update, onSuggestionUsed]
  )

  return {
    state,
    /** The last finished import's brand, for Publish: kept while another is read or refused. */
    importedBrand: last?.brand ?? null,
    run,
    undoRow,
    undoAll,
    dropAssets,
    suggestions,
    useSuggestion,
  }
}

interface ImportSectionProps {
  state: ImportState
  onRun: (input: string) => void
  onUndoRow: (key: ImportRowKey) => void
  /** Everything the import applied, taken back as one step. */
  onUndoAll?: () => void
  /** A logo the site lacked: upload one instead. */
  onUploadWide: () => void
  /** A licensed font the site uses: upload its files. */
  onUploadFont: (family: string) => void
  /** Words the import suggests (the name, a welcome line); none applies without its Use. */
  suggestions?: ImportSuggestion[]
  onUseSuggestion?: (key: SuggestionKey) => void
  /** The website the field starts with: the one a deep link is already importing. */
  initialSite?: string
}

const STATE_NAME: Record<ImportRow['state'], string> = {
  matched: 'Matched',
  nearest: 'Nearest',
  missing: 'Not found',
  skipped: 'Left as it is',
}

/** What each Use button is called, for someone who hears only the button. */
const USE_LABEL: Record<SuggestionKey, string> = {
  name: 'Use the suggested name',
  welcome: 'Use the suggested welcome line',
}

const fontValueOf = (id: string | null | undefined) =>
  id ? BRANDING_FONTS.find((font) => font.id === id)?.value : undefined

/** The Import your brand section's body. */
export function ImportSection({
  state,
  onRun,
  onUndoRow,
  onUndoAll,
  onUploadWide,
  onUploadFont,
  suggestions = [],
  onUseSuggestion,
  initialSite = '',
}: ImportSectionProps) {
  const [value, setValue] = useState(initialSite)
  // A status region that arrives already holding its words is not announced.
  // An import started from the chat opens this section mid-read, so the
  // region goes in empty and takes its words a moment later.
  const [listening, setListening] = useState(false)
  // The address picked from a country picker's own, until it is imported.
  const [picked, setPicked] = useState<string | null>(null)
  // After an import the field gives way to the result, until Import another.
  const [another, setAnother] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => setListening(true), [])
  const reading = state.status === 'reading'
  const done = state.status === 'done' ? state : null

  // A new read puts the field away again once it lands.
  const [seenStatus, setSeenStatus] = useState(state.status)
  if (seenStatus !== state.status) {
    setSeenStatus(state.status)
    if (state.status === 'reading') setAnother(false)
  }

  // The fonts the rows are set in, so each is named in its own face.
  const fontId = done?.brand.font.id
  const headingId = done?.brand.headings?.id
  useEffect(() => {
    if (fontId) void loadBrandingFont(fontId)
    if (headingId) void loadBrandingFont(headingId)
  }, [fontId, headingId])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (value.trim() && !reading) onRun(value)
  }

  const rows = done
    ? importRows(done.brand, {
        logo: done.before.logo.wideKey !== null,
        icon: done.before.logo.icon !== null,
      })
    : []
  const logoRow = rows.find((row) => row.key === 'logo')
  const iconRow = rows.find((row) => row.key === 'icon')
  const listRows = rows.filter((row) => row.key !== 'logo' && row.key !== 'icon')
  // Applied, and taken back since: what the row says Undone for.
  const isUndone = (row: ImportRow) =>
    done !== null && row.applied && !stillApplied(row, done.undone)
  const anyApplied = rows.some((row) => row.applied && !isUndone(row))
  const showForm = !done || another

  const rowUndo = (row: ImportRow) =>
    row.applied && !isUndone(row) ? (
      <QuietUndo label={row.label} onClick={() => onUndoRow(row.key)} />
    ) : null

  return (
    <div className="flex flex-col gap-3">
      {state.status === 'idle' ? (
        <p className="text-xs text-muted-foreground">
          Your logo, colours, font and shape, from your website.
        </p>
      ) : null}
      {showForm ? (
        <form className="flex gap-2" onSubmit={submit}>
          <Input
            ref={field}
            aria-label="Your website"
            placeholder="Your website, like example.com"
            value={value}
            maxLength={2048}
            onChange={(event) => setValue(event.target.value)}
            className="h-8 flex-1"
          />
          <Button type="submit" size="sm" disabled={reading || !value.trim()}>
            Import
          </Button>
        </form>
      ) : null}

      {/* One status line, there from the start, so each stage is announced once: the read,
          then what it found. Once found, it heads the results with the one Undo import. */}
      <div className={cn('flex items-center gap-2', done && '-order-1')}>
        <p
          role="status"
          className={cn(
            'min-w-0 flex-1 text-xs text-muted-foreground empty:sr-only',
            reading && 'flex items-center gap-2',
            done && 'text-foreground'
          )}
        >
          {reading && !listening ? null : reading ? (
            <>
              <span
                aria-hidden="true"
                className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-none"
              />
              Reading {state.host}…
            </>
          ) : done ? (
            <>
              <span className="sr-only">Found. </span>
              {importStatusLine(done)}
            </>
          ) : null}
        </p>
        {done && anyApplied && onUndoAll ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
            onClick={onUndoAll}
          >
            Undo import
          </Button>
        ) : null}
      </div>

      {state.status === 'refused' && state.notRead ? (
        <NotReadNotice
          notRead={state.notRead}
          onRetry={() => onRun(state.input ?? value)}
          onPick={(address) => {
            setValue(address)
            setPicked(address)
          }}
          picked={picked}
        />
      ) : state.status === 'refused' ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}

      {done && logoRow && iconRow ? (
        <div className="grid grid-cols-2 gap-2">
          <AssetTile
            row={logoRow}
            url={done.brand.logo?.url}
            wide
            undone={isUndone(logoRow)}
            action={
              logoRow.state === 'missing' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={onUploadWide}
                >
                  Upload
                </Button>
              ) : (
                rowUndo(logoRow)
              )
            }
          />
          <AssetTile
            row={iconRow}
            url={done.brand.icon?.url}
            undone={isUndone(iconRow)}
            action={rowUndo(iconRow)}
          />
        </div>
      ) : null}

      {done ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {listRows.map((row) => (
            <li key={row.key} className="group flex items-center gap-2.5 px-2.5 py-2">
              <RowVisual row={row} brand={done.brand} />
              <div
                className={cn(
                  'min-w-0 flex-1',
                  (row.state === 'missing' || isUndone(row)) && 'text-muted-foreground'
                )}
              >
                <p className="text-xs font-medium">
                  {row.label}
                  <span className="sr-only">: {STATE_NAME[row.state]}</span>
                </p>
                <p
                  className="line-clamp-2 text-xs text-muted-foreground"
                  style={{ fontFamily: rowFont(row, done.brand) }}
                >
                  {isUndone(row) ? 'Undone' : row.text}
                </p>
                {row.uploadFont ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1.5 h-6 px-2 text-xs"
                    onClick={() => onUploadFont(row.uploadFont!)}
                  >
                    Upload {row.uploadFont}
                  </Button>
                ) : null}
              </div>
              {rowUndo(row)}
            </li>
          ))}
        </ul>
      ) : null}

      {done && suggestions.length > 0 ? (
        <div
          role="group"
          aria-label="Suggestions"
          className="divide-y divide-border rounded-lg border border-border"
        >
          {suggestions.map((suggestion) => (
            <div key={suggestion.key} className="flex items-center gap-2 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{suggestion.label}</p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {suggestion.text}
                </p>
              </div>
              {suggestion.used ? (
                <span className="shrink-0 px-1 text-xs text-muted-foreground">Used</span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  aria-label={USE_LABEL[suggestion.key]}
                  onClick={() => onUseSuggestion?.(suggestion.key)}
                >
                  Use
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {done && !another ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 self-start px-2 text-xs text-muted-foreground"
          onClick={() => {
            setValue('')
            setAnother(true)
            // The field mounts with this render; focus it once it is there.
            requestAnimationFrame(() => field.current?.focus())
          }}
        >
          Import another website
        </Button>
      ) : null}
    </div>
  )
}

/** The font a font row's words are set in: the face it names, where the portal has it. */
function rowFont(row: ImportRow, brand: BrandImport): string | undefined {
  if (row.state === 'missing' || row.state === 'skipped') return undefined
  if (row.key === 'font') return fontValueOf(brand.font.id)
  if (row.key === 'headings') return fontValueOf(brand.headings?.id) ?? fontValueOf(brand.font.id)
  return undefined
}

/** A swatch that shows on white and on black: the colour with a hairline edge. */
function Swatch({ colour, className }: { colour: string; className?: string }) {
  return (
    <span
      title={colour}
      aria-hidden="true"
      className={cn(
        'block size-5 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] ring-2 ring-background dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)]',
        className
      )}
      style={{ backgroundColor: colour }}
    />
  )
}

/** Each row's picture: its colours, its font, its card or its corners. One slot wide for all. */
function RowVisual({ row, brand }: { row: ImportRow; brand: BrandImport }) {
  const slot = (child: ReactNode) => (
    <span aria-hidden="true" className="flex h-6 w-9 shrink-0 items-center justify-center">
      {child}
    </span>
  )
  if (row.state === 'missing') {
    return slot(
      <span className="size-5 rounded-md border border-dashed border-muted-foreground/50" />
    )
  }
  switch (row.key) {
    case 'primary':
      return slot(brand.primary ? <Swatch colour={brand.primary} /> : null)
    case 'page': {
      // The page, its text and the first of its neutrals: what the row is about.
      const colours = [...new Set(row.swatches ?? [])]
      return slot(
        <span className="flex -space-x-1.5">
          {colours.slice(0, 3).map((colour) => (
            <Swatch key={colour} colour={colour} />
          ))}
        </span>
      )
    }
    case 'font':
    case 'headings':
      return slot(
        <span
          className="text-[15px] leading-none font-medium text-foreground"
          style={{ fontFamily: rowFont(row, brand) }}
        >
          Aa
        </span>
      )
    case 'cards':
      return slot(
        <span
          className={cn(
            'block h-4 w-6 rounded-[3px] bg-background',
            brand.cardStyle === 'shadow'
              ? 'shadow-[0_1px_3px_rgb(0_0_0/0.25)]'
              : brand.cardStyle === 'flat'
                ? 'bg-muted'
                : 'border border-foreground/40'
          )}
        />
      )
    case 'shape': {
      // The corners as the site has them, drawn at the size of a small button.
      const px = Math.min((brand.radius ?? 0.5) * 16, 9)
      return slot(
        <span
          className="block h-[18px] w-7 border-[1.5px] border-foreground/60"
          style={{ borderRadius: brand.buttonShape === 'pill' ? 9999 : px }}
        />
      )
    }
    default:
      return slot(null)
  }
}

/** The logo or the icon as found: a real thumbnail, its one line, and its Undo. */
function AssetTile({
  row,
  url,
  wide = false,
  undone,
  action,
}: {
  row: ImportRow
  url: string | undefined
  wide?: boolean
  undone: boolean
  action?: ReactNode
}) {
  const found = row.state !== 'missing' && url
  return (
    <div className="group flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-2">
      <div
        className={cn(
          'flex h-12 items-center justify-center rounded-md',
          found ? 'bg-muted/60' : 'border border-dashed border-muted-foreground/40'
        )}
      >
        {found ? (
          <img
            src={url}
            alt=""
            className={cn('object-contain', wide ? 'max-h-8 max-w-[85%]' : 'size-8 rounded-md')}
          />
        ) : null}
      </div>
      <div className="flex min-h-6 items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">
            {row.label}
            <span className="sr-only">: {STATE_NAME[row.state]}</span>
          </p>
          {row.state === 'missing' || undone ? (
            <p className="text-[11px] leading-tight text-muted-foreground">
              {undone ? 'Undone' : row.text}
            </p>
          ) : null}
        </div>
        {action}
      </div>
    </div>
  )
}

/** A row's own Undo: there for the hand that looks for it, quiet otherwise. */
function QuietUndo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Undo ${label}`}
      title="Undo"
      onClick={onClick}
      className="size-7 shrink-0 text-muted-foreground md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
    >
      <ArrowUturnLeftIcon className="size-3.5" aria-hidden="true" />
    </Button>
  )
}

/** What each kind of page said in the site's place, in the editor's words. */
const NOT_READ_WORDS: Record<SiteNotRead['reason'], { said: string; next: string }> = {
  error: { said: 'showed an error page', next: 'Try again in a few minutes.' },
  bot: { said: 'asked us to prove we’re human', next: 'If it’s your site, allow our reader:' },
  picker: { said: 'opened a country picker', next: 'Pick your site to import it.' },
}

/** A picker whose choices are not addresses we could read: the person types their own. */
const PICKER_NO_ADDRESSES = 'Enter the address of your country’s site.'

/** An address as a person types it: no scheme, no `www.`, no trailing slash. */
const shortAddress = (address: string) =>
  address
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')

/**
 * The site answered, but not with its own page: an error page, a bot check
 * or a country picker. Nothing was imported; this says what happened and
 * offers the one thing to do next.
 */
function NotReadNotice({
  notRead,
  onRetry,
  onPick,
  picked,
}: {
  notRead: SiteNotRead
  onRetry: () => void
  onPick: (address: string) => void
  picked: string | null
}) {
  const [copied, setCopied] = useState(false)
  const words = NOT_READ_WORDS[notRead.reason]
  async function copyName() {
    try {
      await navigator.clipboard.writeText(BRAND_READER_NAME)
    } catch {
      // The name is on the page to copy by hand.
    }
    setCopied(true)
  }
  return (
    <div role="alert" className="rounded-lg border border-border bg-muted/40 px-2.5 py-2.5 text-xs">
      <p className="font-medium text-foreground">
        {notRead.host} {words.said}
      </p>
      <p className="mt-0.5 text-muted-foreground">
        Nothing changed.{' '}
        {notRead.reason === 'picker' && notRead.candidates.length === 0
          ? PICKER_NO_ADDRESSES
          : words.next}
        {notRead.reason === 'bot' ? (
          <>
            {' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
              {BRAND_READER_NAME}
            </code>
          </>
        ) : null}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {notRead.reason === 'error' ? (
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {notRead.reason === 'bot' ? (
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={copyName}>
            {copied ? 'Copied' : 'Copy name'}
          </Button>
        ) : null}
        {notRead.reason === 'picker'
          ? notRead.candidates.map((address) => (
              <Button
                key={address}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 max-w-full"
                aria-pressed={picked === shortAddress(address)}
                onClick={() => onPick(shortAddress(address))}
              >
                <span className="truncate">{shortAddress(address)}</span>
              </Button>
            ))
          : null}
      </div>
      {notRead.reason === 'picker' &&
      picked &&
      notRead.candidates.some((address) => shortAddress(address) === picked) ? (
        <p className="mt-1.5 text-muted-foreground">Ready to import {picked}.</p>
      ) : null}
    </div>
  )
}
