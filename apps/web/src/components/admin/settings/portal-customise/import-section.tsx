import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { CheckIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/shared/utils'
import { importBrandFn } from '@/lib/server/functions/portal-customise'
import { track } from '@/lib/client/analytics'
import { errorText } from '@/lib/client/error-text'
import { BRAND_READER_NAME } from '@/lib/shared/theme/brand-import'
import type { BrandImport, SiteNotRead } from '@/lib/shared/theme/brand-import'
import {
  applySuggestion,
  assetsLabel,
  heldAssets,
  heldRowKeys,
  holdsImportAssets,
  importSuggestions,
  replaceImport,
  importRows,
  revertImportRow,
  setAssetsConfirmed,
  type ImportRow,
  type ImportRowKey,
  type ImportSuggestion,
  type SuggestionKey,
} from './brand-apply'
import type { ConfirmedImport, PortalDraft } from './portal-draft'

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
      /** Rows taken back since. */
      undone: ImportRowKey[]
      /**
       * The brand assets tick was there from the start (the portal is on the
       * site's domain) and the person never touched it. Whether it is ticked
       * now is read from the draft (`holdsImportAssets`), never kept here.
       */
      preTicked: boolean
    }

/**
 * The last import, for the record a publish keeps of its brand assets. The
 * publish names only the assets it really carries, so an import whose assets
 * are held (or were taken back) records nothing.
 */
export function confirmedImport(state: ImportState): ConfirmedImport | null {
  return state.status === 'done' ? { brand: state.brand, preTicked: state.preTicked } : null
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
 * Import your brand: reads a website and puts what it found in the draft as
 * one step. Each result row can be taken back on its own, as its own step.
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
  const [state, setState] = useState<ImportState>({ status: 'idle' })
  // The tick is what the draft holds: undo and redo move it with the assets.
  const confirmed = state.status === 'done' && holdsImportAssets(getDraft(), state.brand)

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
        const previous = state.status === 'done' ? { ...state, confirmed } : null
        // A portal on the site's own domain is the brand itself: its assets start confirmed.
        const preTicked = brand.portalOnSite === true
        const { before, next } = replaceImport(getDraft(), previous, brand, preTicked)
        update(() => next)
        setState({ status: 'done', host: brand.host, brand, before, undone: [], preTicked })
      } catch (error) {
        void track('portal_brand_import', { ok: false, reader: null, missing: [] })
        setState({
          status: 'refused',
          message: errorText(error, "Couldn't import that website. Try again."),
        })
      }
    },
    [update, getDraft, state, confirmed]
  )

  const undoRow = useCallback(
    (key: ImportRowKey) => {
      if (state.status !== 'done' || state.undone.includes(key)) return
      const { before } = state
      // A held row changed nothing: there is nothing to take back.
      const row = importRows(state.brand, undefined, confirmed).find((r) => r.key === key)
      if (!row?.applied) return
      update((draft) => revertImportRow(draft, before, key))
      setState({ ...state, undone: [...state.undone, key] })
    },
    [state, update, confirmed]
  )

  /** Tick or untick the brand assets: they apply, or are taken back, as one step. */
  const confirmAssets = useCallback(
    (next: boolean) => {
      if (state.status !== 'done' || next === confirmed) return
      const { before, brand } = state
      update((draft) => setAssetsConfirmed(draft, before, brand, next))
      const assets = heldRowKeys(brand)
      setState({
        ...state,
        preTicked: false,
        // Ticking brings back any of them taken back on its own.
        undone: next ? state.undone.filter((key) => !assets.includes(key)) : state.undone,
      })
    },
    [state, update, confirmed]
  )

  // The words the import suggests; which are in use is read from the draft, as the tick is.
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

  return { state, confirmed, run, undoRow, confirmAssets, suggestions, useSuggestion }
}

interface ImportSectionProps {
  state: ImportState
  /** Whether the brand assets are confirmed: the draft holds them. */
  confirmed?: boolean
  onRun: (input: string) => void
  onUndoRow: (key: ImportRowKey) => void
  /** A logo the site lacked: upload one instead. */
  onUploadWide: () => void
  /** A licensed font the site uses: upload its files. */
  onUploadFont: (family: string) => void
  /** The brand assets tick: the logo, icon and font apply, or are taken back. */
  onConfirmAssets?: (confirmed: boolean) => void
  /** Words the import suggests (the name, a welcome line); none applies without its Use. */
  suggestions?: ImportSuggestion[]
  onUseSuggestion?: (key: SuggestionKey) => void
  /** The website the field starts with: the one a deep link is already importing. */
  initialSite?: string
}

const STATE_ICON: Record<ImportRow['state'], string> = {
  matched: 'Matched',
  nearest: 'Nearest',
  missing: 'Not found',
  held: 'Waiting for your OK',
  skipped: 'Left as it is',
}

/** What each Use button is called, for someone who hears only the button. */
const USE_LABEL: Record<SuggestionKey, string> = {
  name: 'Use the suggested name',
  welcome: 'Use the suggested welcome line',
}

/** The Import your brand section's body. */
export function ImportSection({
  state,
  confirmed = false,
  onRun,
  onUndoRow,
  onUploadWide,
  onUploadFont,
  onConfirmAssets,
  suggestions = [],
  onUseSuggestion,
  initialSite = '',
}: ImportSectionProps) {
  const confirmId = useId()
  const [value, setValue] = useState(initialSite)
  // A status region that arrives already holding its words is not announced.
  // An import started from the chat opens this section mid-read, so the
  // region goes in empty and takes its words a moment later.
  const [listening, setListening] = useState(false)
  // The address picked from a country picker's own, until it is imported.
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => setListening(true), [])
  const reading = state.status === 'reading'

  function submit(event: FormEvent) {
    event.preventDefault()
    if (value.trim() && !reading) onRun(value)
  }

  const rows =
    state.status === 'done'
      ? importRows(
          state.brand,
          {
            logo: state.before.logo.wideKey !== null,
            icon: state.before.logo.icon !== null,
          },
          confirmed
        )
      : []
  const assets = state.status === 'done' ? heldAssets(state.brand) : []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Your website's logo, colours, font and shape, in one step.
      </p>
      <form className="flex gap-2" onSubmit={submit}>
        <Input
          aria-label="Your website"
          placeholder="Your website, like stripe.com"
          value={value}
          maxLength={2048}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 flex-1"
        />
        <Button type="submit" size="sm" disabled={reading || !value.trim()}>
          Import
        </Button>
      </form>

      {/* One status line, there from the start, so each stage is announced once: the read, then
          what it found. It sits under the rows once they are listed. */}
      <p
        role="status"
        className={cn(
          'text-xs text-muted-foreground empty:sr-only',
          reading && 'flex items-center gap-2',
          state.status === 'done' && 'order-last -mt-1'
        )}
      >
        {reading && !listening ? null : reading ? (
          <>
            <span
              aria-hidden="true"
              className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
            />
            Reading {state.host}: logo, colours, font and shape…
          </>
        ) : state.status === 'done' ? (
          <>
            <span className="sr-only">Found. </span>
            Matched from {state.host}. Everything is in your draft until you publish.
          </>
        ) : null}
      </p>

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

      {state.status === 'done' ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-start gap-2 px-2.5 py-2">
              <StateMark state={row.state} />
              <div
                className={cn('min-w-0 flex-1', row.state === 'held' && 'text-muted-foreground')}
              >
                <p className="text-xs font-medium">{row.label}</p>
                <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {row.swatches?.map((swatch) => (
                    <span
                      key={swatch}
                      aria-hidden="true"
                      className="size-2.5 rounded-full border border-border/70"
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                  {row.text}
                </p>
                {row.key === 'logo' && row.state === 'missing' ? (
                  <Button variant="outline" size="sm" className="mt-1.5 h-7" onClick={onUploadWide}>
                    Upload
                  </Button>
                ) : null}
                {row.uploadFont ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1.5 h-7"
                    onClick={() => onUploadFont(row.uploadFont!)}
                  >
                    Upload {row.uploadFont}
                  </Button>
                ) : null}
              </div>
              {row.applied && !state.undone.includes(row.key) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0"
                  aria-label={`Undo ${row.label}`}
                  onClick={() => onUndoRow(row.key)}
                >
                  Undo
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'done' && assets.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2.5">
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            onChange={(event) => onConfirmAssets?.(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <label htmlFor={confirmId} className="cursor-pointer text-xs font-medium">
            {assetsLabel(assets)}
          </label>
        </div>
      ) : null}

      {state.status === 'done' && suggestions.length > 0 ? (
        <div
          role="group"
          aria-label="Suggestions"
          className="divide-y divide-border rounded-lg border border-border"
        >
          <p className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">Suggestions</p>
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
                  className="h-7 shrink-0"
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
    </div>
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

function StateMark({ state }: { state: ImportRow['state'] }) {
  return (
    <span
      title={STATE_ICON[state]}
      aria-label={STATE_ICON[state]}
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[11px] leading-none',
        state === 'matched' && 'bg-foreground text-background',
        state === 'nearest' && 'border border-foreground text-foreground',
        state === 'missing' && 'border border-muted-foreground/50',
        state === 'held' && 'border-[1.5px] border-dashed border-muted-foreground',
        state === 'skipped' && 'border-[1.5px] border-muted-foreground/60 text-muted-foreground'
      )}
    >
      {state === 'matched' ? (
        <CheckIcon className="size-3" aria-hidden="true" />
      ) : state === 'nearest' ? (
        '≈'
      ) : state === 'skipped' ? (
        <span aria-hidden="true" className="h-[1.5px] w-2 rounded bg-current" />
      ) : null}
    </span>
  )
}
