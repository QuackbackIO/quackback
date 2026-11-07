import { useState, type ReactNode } from 'react'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import { colourName, plainWords } from '@/lib/shared/design/colour-names'
import { matchSummary } from '@/lib/shared/design/step-summary'
import { overrideChangeLines } from '@/lib/shared/design/override-cascade'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import { MATCH_BRAND, type UnmatchedFont } from '@/lib/shared/design/match-brand'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  applyDesignChanges,
  changeState,
  type AppliedDesignChange,
} from '@/lib/shared/design/apply-changes'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { ChangeValue, changeLabel, shownValue } from './change-list'
import { HeroPhotoChip } from './hero-photo-chip'
import type { DesignAiTurn } from './use-design-ai'

/** Changes the draft, naming the change for undo when a name is given. */
type Update = (change: (draft: PortalDesign) => void, label?: string) => void

/** A value as a row says it: a colour by its name beside a swatch, never its code. */
function RowValue({ value }: { value: unknown }) {
  if (typeof value === 'string' && isColour(value))
    return (
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden="true"
          className="size-3 rounded-sm border border-border"
          style={{ background: value }}
        />
        {capital(colourName(value))}
      </span>
    )
  return <ChangeValue value={value} />
}

const isColour = (value: string) => /^(#[0-9a-f]{3}|#[0-9a-f]{6}|oklch\()/i.test(value)
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** What a value reads as, for leaving out a row whose two sides read the same. */
const readAs = (value: unknown) =>
  typeof value === 'string' && isColour(value) ? colourName(value) : JSON.stringify(value ?? null)

type Row = { key: string; label: string; before: unknown; after: unknown }

/**
 * A value a person cannot read as a change: a list or object that would only
 * say "Changed", or an exact size the builder set (sizes show on the page).
 */
const technical = (value: unknown) =>
  (!!value && typeof value === 'object') ||
  (typeof value === 'string' && /^-?[\d.]+ (px|em)$/.test(value))

/**
 * The rows a change makes: one for a plain value, one for each value inside
 * an object that reads only as "Changed", and none where both sides read the same.
 */
function rowsOf(path: string, before: unknown, after: unknown, label?: string, depth = 0): Row[] {
  const was = shownValue(path, before)
  const now = shownValue(path, after)
  const nested = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (depth < 4 && (nested(was) || nested(now))) {
    const keys = new Set([
      ...Object.keys(nested(before) ? (before as object) : {}),
      ...Object.keys(nested(after) ? (after as object) : {}),
    ])
    const at = (v: unknown, key: string) =>
      nested(v) ? (v as Record<string, unknown>)[key] : undefined
    return [...keys].flatMap((key) =>
      rowsOf(`${path}.${key}`, at(before, key), at(after, key), undefined, depth + 1)
    )
  }
  if (readAs(was) === readAs(now) || [was, now].some(technical)) return []
  return [
    { key: path, label: (label ?? changeLabel(path)).replace(': ', ' '), before: was, after: now },
  ]
}

/**
 * What one request did, under its reply: one Undo for the whole step, and
 * the changes, as "Thing: old → new", behind Show changes. The Undo takes
 * back what still holds; a value changed since is left as it is now.
 */
function StepResult({
  changes,
  readability,
  notes,
  design,
  update,
}: {
  changes: AppliedDesignChange[]
  readability: string[]
  notes: string[]
  /** The draft as it is now. */
  design: PortalDesign
  update: Update
}) {
  const [open, setOpen] = useState(false)
  const undo = (rows: AppliedDesignChange[]) => {
    update((draft) => {
      const restored = applyDesignChanges(
        draft,
        rows.map((row) => ({ path: row.path, value: row.before })),
        'site'
      )
      // A field the change brought in, such as the first override, goes again.
      for (const key of Object.keys(draft))
        if (!(key in restored.design)) delete (draft as Record<string, unknown>)[key]
      Object.assign(draft, restored.design)
    })
  }
  const holding = changes.filter((change) => changeState(design, change) === 'applied')
  const undone = changes.every((change) => changeState(design, change) === 'undone')
  const lines = changes.flatMap((change): Array<{ key: string; line?: string; row?: Row }> =>
    change.path === 'overrides'
      ? overrideChangeLines(
          design,
          change.before as StyleOverride[] | null,
          change.after as StyleOverride[] | null
        ).map((line) => ({ key: line, line }))
      : rowsOf(change.path, change.before, change.after, change.label).map((row) => ({
          key: row.key,
          row,
        }))
  )
  const details = lines.length > 0 || readability.length > 0 || notes.length > 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {details && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="inline-flex items-center gap-0.5 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground"
          >
            {open ? 'Hide changes' : 'Show changes'}
            <ChevronDownIcon
              aria-hidden="true"
              className={cn('size-3.5 transition-transform', open && 'rotate-180')}
            />
          </button>
        )}
        {holding.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto -my-1 h-7 px-2 focus-visible:ring-muted-foreground"
            onClick={() => undo(holding)}
          >
            Undo
          </Button>
        ) : (
          undone && <span className="ms-auto">Undone</span>
        )}
      </div>
      {open && (
        <div data-changes className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs">
          {lines.length > 0 && (
            <ul className="space-y-1">
              {lines.map((each) => (
                <li key={each.key} className="flex flex-wrap items-center gap-x-1">
                  {each.row ? (
                    <>
                      <span className="text-muted-foreground">{each.row.label}:</span>
                      <RowValue value={each.row.before} />
                      <span aria-hidden="true">→</span>
                      <RowValue value={each.row.after} />
                    </>
                  ) : (
                    each.line
                  )}
                </li>
              ))}
            </ul>
          )}
          {readability.length > 0 && (
            <p className="text-muted-foreground">
              Also adjusted {readability.join(', ')} so text stays readable.
            </p>
          )}
          {notes.map((note) => (
            <p key={note} className="text-muted-foreground">
              {plainWords(note)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** What a reply says: a brand match in one line of the parts it matched, else its own words. */
export function replyText(turn: Extract<DesignAiTurn, { role: 'assistant' }>): string {
  if (!turn.matched || !turn.changes?.length) return plainWords(turn.text)
  return matchSummary(
    turn.changes.map((change) => change.path),
    { logo: !!turn.brand }
  )
}

/**
 * What a screen reader hears when a turn arrives: the reply's one line, not
 * every change. While a request is worked on, the stage it is at.
 */
export function turnSummary(turn: DesignAiTurn | undefined): string {
  if (!turn || turn.role !== 'assistant') return ''
  return replyText(turn)
}

/** The colours read from an image, as small swatches. */
export function PaletteSwatches({ palette }: { palette: string[] }) {
  return (
    <span role="img" className="mt-1.5 flex gap-1" aria-label={`Colours: ${palette.join(', ')}`}>
      {palette.map((colour) => (
        <span
          key={colour}
          aria-hidden="true"
          className="size-4 rounded-full border border-border"
          style={{ backgroundColor: colour }}
        />
      ))}
    </span>
  )
}

/**
 * Ask AI: the conversation, and nothing before the first request but the
 * request box. Every change lands in the draft; nothing is live until a
 * person publishes.
 */
export function AskAiPanel({
  available,
  turns,
  busy,
  stage,
  steps = [],
  design,
  update,
  renderBrand,
  onWiden,
  onChip,
  onHeroPhoto,
  onRecapture,
  onUploadFont,
  onFonts,
}: {
  available: boolean
  turns: DesignAiTurn[]
  busy: boolean
  /** What a request is at while it is worked on, such as "Matching your brand…". */
  stage?: string | null
  /** A brand match's stages so far, the last one running. */
  steps?: string[]
  /** The draft as it is now, so each change card says whether it still holds. */
  design: PortalDesign
  update: Update
  /** The card for the logo a brand match placed, under that reply. */
  renderBrand?: (turn: Extract<DesignAiTurn, { role: 'assistant' }>, index: number) => ReactNode
  /** Asks a request again about the whole site, when it reached outside the section picked. */
  onWiden: (text: string) => void
  /** Puts a follow-up into the request box. */
  onChip?: (text: string) => void
  /** A hero photo uploaded from the "Add a hero photo" follow-up, by its key. */
  onHeroPhoto?: (key: string) => void
  /** Captures a brand's site again, from the capture a match was made from. */
  onRecapture?: (url: string) => void
  /** Opens the font upload for the brand's own face a match could not match. */
  onUploadFont?: (font: UnmatchedFont) => void
  /** Opens the fonts in Theme's Brand kit. */
  onFonts?: () => void
}) {
  if (!available) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Quackback AI is not set up. Everything else works.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Always there, so what it is set to is read out: the stage, then a summary of the answer. */}
      <p role="status" className="sr-only">
        {busy ? (stage ?? 'Working on it…') : turnSummary(turns.at(-1))}
      </p>
      <ol className="space-y-3">
        {turns.map((turn, index) => (
          <li key={index} className={cn('text-[13.5px]', turn.role === 'user' && 'ms-8')}>
            {turn.role === 'user' ? (
              <div className="rounded-2xl bg-muted px-3 py-2">
                <p>{turn.text}</p>
                {turn.images && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {turn.images.map((src, at) => (
                      <li key={at}>
                        <img
                          src={src}
                          alt={`Attached image ${at + 1}`}
                          className="size-10 rounded-md object-cover"
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {turn.palette && <PaletteSwatches palette={turn.palette} />}
              </div>
            ) : (
              <div className="space-y-2">
                <p>{replyText(turn)}</p>
                {turn.widen && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onWiden(turn.widen!)}
                  >
                    Ask about the whole site
                  </Button>
                )}
                {turn.changes && turn.changes.length > 0 && (
                  <StepResult
                    changes={turn.changes}
                    readability={turn.readability ?? []}
                    notes={turn.notes ?? []}
                    design={design}
                    update={update}
                  />
                )}
                {turn.capture && (
                  <SiteCapture capture={turn.capture} busy={busy} onRecapture={onRecapture} />
                )}
                {turn.brand && renderBrand?.(turn, index)}
                {turn.font && onUploadFont && onFonts && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" size="sm" onClick={() => onUploadFont(turn.font!)}>
                      Upload {turn.font.family}
                    </Button>
                    <button
                      type="button"
                      onClick={onFonts}
                      className="rounded text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground"
                    >
                      Fonts in Theme
                    </button>
                  </div>
                )}
                {turn.asks?.map((question) => (
                  <p key={question} className="text-[13px] text-muted-foreground">
                    {plainWords(question)}
                  </p>
                ))}
                {!turn.changes?.length && turn.notes && turn.notes.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {turn.notes.map((note) => (
                      <li key={note}>{plainWords(note)}</li>
                    ))}
                  </ul>
                )}
                {turn.chips && turn.chips.length > 0 && onChip && index === turns.length - 1 && (
                  <ul aria-label="Follow-ups" className="flex flex-wrap gap-1.5">
                    {turn.chips.map((chip) => (
                      <li key={chip}>
                        {chip === MATCH_BRAND.addHeroPhoto && onHeroPhoto ? (
                          <HeroPhotoChip onUploaded={onHeroPhoto} disabled={busy} />
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onChip(chip)}
                            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground disabled:opacity-50"
                          >
                            {chip}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
        {busy &&
          (steps.length > 0 ? (
            <li>
              <ol aria-label="Progress" className="space-y-1 text-[13px] text-muted-foreground">
                {steps.map((step, at) => (
                  <li key={step} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="w-3 text-center">
                      {at < steps.length - 1 ? '✓' : '·'}
                    </span>
                    {at < steps.length - 1 ? step : `${step}…`}
                  </li>
                ))}
              </ol>
            </li>
          ) : (
            <li className="text-[13px] text-muted-foreground">{stage ?? 'Working on it…'}</li>
          ))}
      </ol>
    </div>
  )
}

/**
 * The capture of the brand's site a match was made from: the page as it was
 * matched, where it came from, and Capture again once a day has passed.
 */
export function SiteCapture({
  capture,
  busy,
  onRecapture,
  now = Date.now(),
}: {
  capture: NonNullable<Extract<DesignAiTurn, { role: 'assistant' }>['capture']>
  busy: boolean
  onRecapture?: (url: string) => void
  now?: number
}) {
  const later = now < Date.parse(capture.againFrom)
  return (
    <figure className="mt-2 space-y-1.5">
      <img
        src={capture.image}
        alt={MATCH_BRAND.captured(capture.host)}
        className="w-full rounded-lg border border-border"
      />
      <figcaption className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{MATCH_BRAND.captured(capture.host)}</span>
        {onRecapture &&
          (later ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="rounded outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
                >
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled>
                    {MATCH_BRAND.captureAgain}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{MATCH_BRAND.captureAgainLater}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => onRecapture(capture.url)}
            >
              {MATCH_BRAND.captureAgain}
            </Button>
          ))}
        <span>{MATCH_BRAND.ownScreenshot}</span>
      </figcaption>
    </figure>
  )
}
