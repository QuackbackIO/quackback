import { useState, type ReactNode } from 'react'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import { plainWords } from '@/lib/shared/design/colour-names'
import { matchSummary } from '@/lib/shared/design/step-summary'
import {
  chipChange,
  lookChanges,
  matchParts,
  MATCH_PART_LABEL,
} from '@/lib/shared/design/match-steps'
import { overrideChangeLines } from '@/lib/shared/design/override-cascade'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import { MATCH_BRAND, type UnmatchedFont } from '@/lib/shared/design/match-brand'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  applyDesignChanges,
  changeState,
  type AppliedDesignChange,
  type DesignChangeRequest,
} from '@/lib/shared/design/apply-changes'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { changeRows, type ChangeRow, type RowChange, type RowSide } from './change-rows'
import { HeroPhotoChip } from './hero-photo-chip'
import type { StoredHero } from './use-image-upload'
import type { DesignAiTurn } from './use-design-ai'
import { Swatch } from '@/components/designer/swatch'

/** Changes the draft, naming the change for undo when a name is given. */
type Update = (change: (draft: PortalDesign) => void, label?: string) => void

/** Where a row's change shows on the canvas: whether it can be pointed at, and going there. */
export interface ShowChange {
  can: (at: RowChange) => boolean
  /** Shows the change on the canvas; `words` is the row as it reads. */
  go: (at: RowChange, words: string) => void
}

/**
 * Puts changes into the draft as the design allows, as Undo does: a field
 * set to nothing goes from the draft.
 */
function putChanges(draft: PortalDesign, changes: DesignChangeRequest[]): AppliedDesignChange[] {
  const next = applyDesignChanges(draft, changes, 'site')
  for (const key of Object.keys(draft))
    if (!(key in next.design)) delete (draft as Record<string, unknown>)[key]
  Object.assign(draft, next.design)
  return next.applied
}

/** Puts changes into the draft as one step, named when a label is given. */
const putAsStep = (update: Update, changes: DesignChangeRequest[], label?: string) =>
  update((draft) => void putChanges(draft, changes), label)

/** A row as it reads, for its Show's name and what is said once it is shown. */
const rowWords = (row: ChangeRow) =>
  'text' in row ? row.text : `${row.label}: ${row.before.words} → ${row.after.words}`

/** A row's Show: to the page the change is on, its part outlined. */
function ShowButton({ row, onShow }: { row: ChangeRow; onShow: ShowChange['go'] }) {
  const words = rowWords(row)
  return (
    <button
      type="button"
      aria-label={`Show ${words} on the page`}
      onClick={() => onShow(row.at, words)}
      className="ms-auto rounded px-1 text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground"
    >
      Show
    </button>
  )
}

/** One side of a row: its words, beside a swatch only when it is an actual colour. */
function RowValue({ side }: { side: RowSide }) {
  if (!side.swatch) return <span>{side.words}</span>
  return (
    <span className="inline-flex items-center gap-1">
      <Swatch colour={side.swatch} className="size-3" />
      {side.words}
    </span>
  )
}

/**
 * What one request did, under its reply: one Undo for the whole step, and
 * the changes, as "Thing: old → new", behind Show changes. The Undo takes
 * back what still holds; a value changed since is left as it is now. A
 * brand match also undoes in parts (brand, hero, words), inside Show changes.
 */
function StepResult({
  changes,
  readability,
  notes,
  design,
  update,
  show,
  parts = false,
}: {
  changes: AppliedDesignChange[]
  readability: string[]
  notes: string[]
  /** The draft as it is now. */
  design: PortalDesign
  update: Update
  show?: ShowChange
  /** Offer Undo by part (brand, hero, words) under Show changes, as a brand match does. */
  parts?: boolean
}) {
  const [open, setOpen] = useState(false)
  // A field the change brought in, such as the first override, goes again.
  const undo = (rows: AppliedDesignChange[], label?: string) =>
    putAsStep(
      update,
      rows.map((row) => ({ path: row.path, value: row.before })),
      label
    )
  const holding = changes.filter((change) => changeState(design, change) === 'applied')
  const undone = changes.every((change) => changeState(design, change) === 'undone')
  // One row per operation, in words; an override's lines say what it set where.
  const lines: Array<{ key: string; line?: string; row?: ChangeRow }> = [
    ...changeRows(changes.filter((change) => change.path !== 'overrides')).map((row) => ({
      key: row.key,
      row,
    })),
    ...changes
      .filter((change) => change.path === 'overrides')
      .flatMap((change) =>
        overrideChangeLines(
          design,
          change.before as StyleOverride[] | null,
          change.after as StyleOverride[] | null
        ).map((line) => ({ key: line, line }))
      ),
  ]
  // Parts that still hold something to take back; only worth offering when there are two or more.
  const partUndos = parts ? matchParts(holding) : []
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
                  {each.row && 'text' in each.row ? (
                    <>
                      {each.row.swatch && <Swatch colour={each.row.swatch} className="size-3" />}
                      {each.row.text}
                    </>
                  ) : each.row ? (
                    <>
                      <span className="text-muted-foreground">{each.row.label}:</span>
                      <RowValue side={each.row.before} />
                      <span aria-hidden="true">→</span>
                      <RowValue side={each.row.after} />
                    </>
                  ) : (
                    each.line
                  )}
                  {each.row && show?.can(each.row.at) && (
                    <ShowButton row={each.row} onShow={show.go} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {partUndos.length > 1 && (
            <div aria-label="Undo in parts" role="group" className="flex flex-wrap gap-x-3">
              {partUndos.map(({ part, changes: rows }) => (
                <button
                  key={part}
                  type="button"
                  onClick={() => undo(rows, MATCH_PART_LABEL[part])}
                  className="rounded text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground"
                >
                  {MATCH_PART_LABEL[part]}
                </button>
              ))}
            </div>
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
    { logo: !!turn.brand, fontsNearest: !!turn.fontsNearest || !!turn.font }
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
  show,
  onDirect,
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
  onHeroPhoto?: (image: StoredHero) => void
  /** Captures a brand's site again, from the capture a match was made from. */
  onRecapture?: (url: string) => void
  /** Opens the font upload for the brand's own face a match could not match. */
  onUploadFont?: (font: UnmatchedFont) => void
  /** Opens the fonts in Theme's Brand kit. */
  onFonts?: () => void
  /** Shows a change on the canvas, from its row's Show; without it, rows have none. */
  show?: ShowChange
  /**
   * Records a change made here with no request (a one-change follow-up, or
   * another look), so it shows as its own step with Undo. Without it, every
   * follow-up is a request.
   */
  onDirect?: (step: { label: string; reply: string; changes: AppliedDesignChange[] }) => void
}) {
  // How many of each match's other looks have been tried, by turn.
  const [tried, setTried] = useState<Record<number, number>>({})
  /** Makes known changes now, as one named step, and records it; false when nothing changed. */
  const direct = (label: string, reply: string, changes: DesignChangeRequest[]) => {
    if (!onDirect) return false
    const applied = putChanges(structuredClone(design), changes)
    if (!applied.length) return false
    putAsStep(update, changes, label)
    onDirect({ label, reply, changes: applied })
    return true
  }
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
                    parts={!!turn.matched}
                    {...(show ? { show } : {})}
                  />
                )}
                {turn.matched &&
                  turn.changes &&
                  onDirect &&
                  (turn.others?.length ?? 0) > (tried[index] ?? 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-my-1 h-7 px-2 text-xs text-muted-foreground"
                      disabled={busy}
                      onClick={() => {
                        const others = turn.others!
                        const look = others[tried[index] ?? 0]!
                        direct(
                          'Try another look',
                          plainWords(look.description),
                          lookChanges(turn.changes!, others, look)
                        )
                        setTried((was) => ({ ...was, [index]: (was[index] ?? 0) + 1 }))
                      }}
                    >
                      Try another look
                    </Button>
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
                            onClick={() => {
                              const change = chipChange(chip)
                              if (!change || !direct(chip, 'Done.', change)) onChip(chip)
                            }}
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
