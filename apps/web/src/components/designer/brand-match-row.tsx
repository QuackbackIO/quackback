/**
 * Theme > Brand kit's first row: Match your brand, from the brand's website
 * (prefilled from what the workspace knows) and up to three screenshots. It
 * runs the brand match Ask AI runs, through the builder's own entry point,
 * so the reply and its Undo show in the conversation. Once a match has run
 * the row stays, quieter, as Match again.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, PhotoIcon, XMarkIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_MATCH_SHOTS } from '@/components/admin/settings/appearance/match-shots'
import { trackBuilder } from '@/lib/client/builder-events'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { readSiteBrandFn } from '@/lib/server/functions/site-brand'
import { hasMatched } from '@/lib/shared/design/ai-starters'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  applySiteBrand,
  offeredPicks,
  type SiteBrandOffer,
  type SiteBrandPick,
} from '@/lib/shared/design/site-brand'
import { cn } from '@/lib/shared/utils'
import { useEscapeToDismiss } from './menu-coach-mark'
import { PropertyRow } from './properties/properties-panel'
import { Swatch } from './swatch'

/** The row's words. */
export const MATCH_ROW = {
  title: 'Match your brand',
  website: 'Your website',
  placeholder: 'yourcompany.com',
  match: 'Match',
  matching: 'Matching…',
  again: 'Match again',
  rowLabel: 'Brand match',
  shots: `Add up to ${MAX_MATCH_SHOTS} screenshots`,
  tooMany: `Up to ${MAX_MATCH_SHOTS} screenshots.`,
  imagesOnly: 'Only PNG, JPEG or WebP images.',
  cancel: 'Cancel',
  /** Without Quackback AI. */
  useTitle: 'Use from your website',
  read: 'Read',
  reading: 'Reading…',
  use: 'Use',
  useAgain: 'Use again',
  useRowLabel: 'Your website',
  found: (host: string) => `From ${host}`,
  picks: {
    logo: 'Logo',
    favicon: 'Favicon',
    shareImage: 'Share image',
    colour: 'Brand colour',
  } satisfies Record<SiteBrandPick, string>,
  failed: 'That website could not be read.',
  coach: 'Paste your website to match your brand',
  coachDone: 'Got it',
} as const

/** Changes the draft as one step, named for its undo. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** The row's stable name, which Settings > Portal's Match your brand leads to. */
export const BRAND_MATCH_FIND = 'kit-match'

/** What the builder lends the row: whether a match runs, the website it knows, and the start. */
export interface BrandMatchControl {
  busy: boolean
  /** The workspace's website, when known, to prefill the field. */
  website: string | null
  /** Starts a brand match (see useDesignAi's startBrandMatch). */
  start: (input: { website?: string; screenshots: File[] }) => void
  /** The first-open coach mark, which points here while no match has run. */
  coach?: { show: boolean; dismiss: () => void }
}

const BrandMatchContext = createContext<BrandMatchControl | null>(null)

/** Lends the Brand kit's Match row the builder's brand match; outside it the row shows nothing. */
export function BrandMatchProvider({
  value,
  children,
}: {
  value: BrandMatchControl
  children: ReactNode
}) {
  return <BrandMatchContext.Provider value={value}>{children}</BrandMatchContext.Provider>
}

const SHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** The files a drop carries. */
function filesOf(data: DataTransfer | null): File[] {
  return data ? Array.from(data.files ?? []) : []
}

/** A screenshot waiting to be sent, with the thumbnail it shows. */
interface Waiting {
  id: number
  file: File
  url: string | null
}

function thumbnailOf(file: File): string | null {
  try {
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

/** The screenshots dropped or picked for a match, up to three. */
function useWaitingShots() {
  const [shots, setShots] = useState<Waiting[]>([])
  const [note, setNote] = useState('')
  const next = useRef(0)
  const latest = useRef(shots)
  latest.current = shots
  useEffect(
    () => () => {
      for (const shot of latest.current) if (shot.url) URL.revokeObjectURL(shot.url)
    },
    []
  )
  const add = (files: File[]) => {
    const images = files.filter((file) => SHOT_TYPES.has(file.type))
    const room = Math.max(0, MAX_MATCH_SHOTS - latest.current.length)
    setNote(
      images.length < files.length
        ? MATCH_ROW.imagesOnly
        : images.length > room
          ? MATCH_ROW.tooMany
          : ''
    )
    const taken = images
      .slice(0, room)
      .map((file) => ({ id: next.current++, file, url: thumbnailOf(file) }))
    if (taken.length) setShots((now) => [...now, ...taken].slice(0, MAX_MATCH_SHOTS))
  }
  const remove = (id: number) =>
    setShots((now) =>
      now.filter((shot) => {
        if (shot.id === id && shot.url) URL.revokeObjectURL(shot.url)
        return shot.id !== id
      })
    )
  const clear = () => {
    setShots([])
    setNote('')
  }
  return { shots, note, add, remove, clear }
}

/** The dashed box screenshots are dropped on, or picked from. */
function ShotDrop({
  shots,
  note,
  onAdd,
  onRemove,
}: {
  shots: Waiting[]
  note: string
  onAdd: (files: File[]) => void
  onRemove: (id: number) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const carriesFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')
  return (
    <div className="space-y-1.5">
      {shots.length > 0 && (
        <ul aria-label="Screenshots" className="flex flex-wrap gap-2 pt-1">
          {shots.map((shot) => (
            <li key={shot.id} className="relative">
              {shot.url ? (
                <img
                  src={shot.url}
                  alt={shot.file.name}
                  className="size-12 rounded-md border border-border object-cover"
                />
              ) : (
                <span className="grid size-12 place-items-center rounded-md border border-border text-[11px] text-muted-foreground">
                  {shot.file.name}
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${shot.file.name}`}
                onClick={() => onRemove(shot.id)}
                className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
              >
                <XMarkIcon className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {shots.length < MAX_MATCH_SHOTS && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            if (!carriesFiles(event)) return
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            if (!carriesFiles(event)) return
            event.preventDefault()
            setOver(false)
            onAdd(filesOf(event.dataTransfer))
          }}
          className={cn(
            'flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
            over ? 'border-muted-foreground bg-muted' : 'border-border'
          )}
        >
          <PhotoIcon className="size-3.5" aria-hidden="true" />
          {MATCH_ROW.shots}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          onAdd(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      {note && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  )
}

/**
 * The first-open coach mark, under the website field it points at, in the
 * panel's own order so the keyboard reaches it. Got it or Escape closes it.
 */
function BrandCoach({ onDismiss }: { onDismiss: () => void }) {
  useEscapeToDismiss(true, onDismiss)
  return (
    <div
      role="note"
      aria-label={MATCH_ROW.coach}
      className="relative mt-2.5 flex items-center gap-2 rounded-lg border border-border bg-popover py-1.5 ps-3 pe-1.5 text-popover-foreground shadow-sm"
    >
      <span
        aria-hidden="true"
        className="absolute -top-1.5 start-4 size-3 rotate-45 border-s border-t border-border bg-popover"
      />
      <p className="min-w-0 flex-1 text-xs">{MATCH_ROW.coach}</p>
      <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs" onClick={onDismiss}>
        {MATCH_ROW.coachDone}
      </Button>
    </div>
  )
}

/** The coach mark, while it should show: only before any match has run. */
function coachOf(control: BrandMatchControl, design: PortalDesign) {
  return control.coach?.show && !hasMatched(design) ? control.coach : null
}

/** The website field, the screenshots and Match, as one small form. */
function MatchForm({
  control,
  coach,
  onCancel,
  onSent,
}: {
  control: BrandMatchControl
  coach: { dismiss: () => void } | null
  /** With it, a Cancel beside Match, for a form opened from Match again. */
  onCancel?: () => void
  onSent?: () => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const website = typed ?? control.website ?? ''
  // Opened from Match again, the field takes focus, so the keyboard lands where the form is.
  const field = useRef<HTMLInputElement>(null)
  const opened = !!onCancel
  useEffect(() => {
    if (opened) field.current?.focus()
  }, [opened])
  const waiting = useWaitingShots()
  const sendable = (!!website.trim() || waiting.shots.length > 0) && !control.busy
  const send = () => {
    if (!sendable) return
    control.start({
      ...(website.trim() ? { website: website.trim() } : {}),
      screenshots: waiting.shots.map((shot) => shot.file),
    })
    waiting.clear()
    coach?.dismiss()
    onSent?.()
  }
  return (
    <div
      data-brand-match=""
      className="space-y-1.5 pb-1.5"
      onPaste={(event) => {
        const files = filesOf(event.clipboardData)
        if (!files.length) return
        event.preventDefault()
        waiting.add(files)
      }}
    >
      <p className="text-xs font-medium">{MATCH_ROW.title}</p>
      <div className="flex items-center gap-1.5">
        <Input
          ref={field}
          id="brand-match-website"
          aria-label={MATCH_ROW.website}
          value={website}
          placeholder={MATCH_ROW.placeholder}
          inputMode="url"
          autoComplete="url"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            send()
          }}
          className="h-7 min-w-0 flex-1 px-1.5 text-xs"
        />
        <Button size="sm" className="h-7 px-2.5 text-xs" disabled={!sendable} onClick={send}>
          {control.busy ? MATCH_ROW.matching : MATCH_ROW.match}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>
            {MATCH_ROW.cancel}
          </Button>
        )}
      </div>
      {coach && <BrandCoach onDismiss={coach.dismiss} />}
      <ShotDrop
        shots={waiting.shots}
        note={waiting.note}
        onAdd={waiting.add}
        onRemove={waiting.remove}
      />
    </div>
  )
}

/** One thing the site gave, as a chip that is checked or not. */
function PickChip({
  pick,
  offer,
  checked,
  onToggle,
}: {
  pick: SiteBrandPick
  offer: SiteBrandOffer
  checked: boolean
  onToggle: () => void
}) {
  const image =
    pick === 'logo'
      ? offer.logo?.key
      : pick === 'favicon'
        ? offer.favicon?.key
        : pick === 'shareImage'
          ? offer.shareImage?.key
          : null
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
        checked
          ? 'border-foreground/40 bg-muted text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {checked && <CheckIcon className="size-3.5" aria-hidden="true" />}
      {image && (
        <img
          src={designAssetUrl(image)}
          alt=""
          className="size-4 rounded-sm border border-border object-contain"
        />
      )}
      {pick === 'colour' && offer.colour && <Swatch colour={offer.colour} />}
      {MATCH_ROW.picks[pick]}
    </button>
  )
}

/**
 * Use from your website, for a workspace without Quackback AI: the site read
 * from its code, what it gave offered as checked chips, and the checked ones
 * used as one undo step. Font names are never offered.
 */
function SiteUseForm({
  control,
  coach,
  update,
  onCancel,
  onUsed,
}: {
  control: BrandMatchControl
  coach: { dismiss: () => void } | null
  update: NamedUpdate
  onCancel?: () => void
  onUsed?: () => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const website = typed ?? control.website ?? ''
  const [reading, setReading] = useState(false)
  const [offer, setOffer] = useState<SiteBrandOffer | null>(null)
  const [picks, setPicks] = useState<ReadonlySet<SiteBrandPick>>(new Set())
  const [said, setSaid] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const opened = !!onCancel
  useEffect(() => {
    if (opened) field.current?.focus()
  }, [opened])
  const read = async () => {
    if (!website.trim() || reading) return
    coach?.dismiss()
    setReading(true)
    setSaid('')
    setOffer(null)
    try {
      const result = await readSiteBrandFn({ data: { url: website.trim() } })
      if (!result.ok) {
        setSaid(result.message)
        return
      }
      setOffer(result.offer)
      setPicks(new Set(offeredPicks(result.offer)))
    } catch {
      setSaid(MATCH_ROW.failed)
    } finally {
      setReading(false)
    }
  }
  const use = () => {
    if (!offer || !picks.size) return
    const used = offer
    const chosen = picks
    update((draft) => applySiteBrand(draft, used, chosen, new Date()), MATCH_ROW.useTitle)
    trackBuilder('designer_site_brand_used', {
      logo: chosen.has('logo'),
      favicon: chosen.has('favicon'),
      shareImage: chosen.has('shareImage'),
      colour: chosen.has('colour'),
    })
    setOffer(null)
    onUsed?.()
  }
  const toggle = (pick: SiteBrandPick) =>
    setPicks((now) => {
      const next = new Set(now)
      if (next.has(pick)) next.delete(pick)
      else next.add(pick)
      return next
    })
  return (
    <div data-site-use="" className="space-y-1.5 pb-1.5">
      <p className="text-xs font-medium">{MATCH_ROW.useTitle}</p>
      <div className="flex items-center gap-1.5">
        <Input
          ref={field}
          id="brand-match-website"
          aria-label={MATCH_ROW.website}
          value={website}
          placeholder={MATCH_ROW.placeholder}
          inputMode="url"
          autoComplete="url"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void read()
          }}
          className="h-7 min-w-0 flex-1 px-1.5 text-xs"
        />
        <Button
          size="sm"
          variant={offer ? 'outline' : 'default'}
          className="h-7 px-2.5 text-xs"
          disabled={!website.trim() || reading}
          onClick={() => void read()}
        >
          {reading ? MATCH_ROW.reading : MATCH_ROW.read}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>
            {MATCH_ROW.cancel}
          </Button>
        )}
      </div>
      {coach && <BrandCoach onDismiss={coach.dismiss} />}
      {offer && (
        <div className="space-y-1.5">
          <div
            role="group"
            aria-label={MATCH_ROW.found(offer.host)}
            className="flex flex-wrap gap-1.5"
          >
            {offeredPicks(offer).map((pick) => (
              <PickChip
                key={pick}
                pick={pick}
                offer={offer}
                checked={picks.has(pick)}
                onToggle={() => toggle(pick)}
              />
            ))}
          </div>
          <Button size="sm" className="h-7 px-2.5 text-xs" disabled={!picks.size} onClick={use}>
            {MATCH_ROW.use}
          </Button>
        </div>
      )}
      {said && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {said}
        </p>
      )}
    </div>
  )
}

/**
 * Match your brand, first in the Brand kit: the form until a match has run,
 * then a quiet row whose Match again opens it. Without Quackback AI it is
 * Use from your website, the same way round.
 */
export function BrandMatchRow({ design, update }: { design: PortalDesign; update: NamedUpdate }) {
  const control = useContext(BrandMatchContext)
  const status = useQuery({ ...portalDesignQueries.aiStatus(), enabled: !!control })
  const [again, setAgain] = useState(false)
  if (!control || !status.data) return null
  return (
    <div data-find={BRAND_MATCH_FIND}>
      <MatchRowBody
        control={control}
        design={design}
        update={update}
        withAi={status.data.available}
        again={again}
        setAgain={setAgain}
      />
    </div>
  )
}

/** The match form, or once a match has run the quiet row that opens it again. */
function MatchRowBody({
  control,
  design,
  update,
  withAi,
  again,
  setAgain,
}: {
  control: BrandMatchControl
  design: PortalDesign
  update: NamedUpdate
  withAi: boolean
  again: boolean
  setAgain: (again: boolean) => void
}) {
  const close = { onCancel: () => setAgain(false) }
  if (!hasMatched(design) || again)
    return withAi ? (
      <MatchForm
        control={control}
        coach={coachOf(control, design)}
        {...(again ? { ...close, onSent: () => setAgain(false) } : {})}
      />
    ) : (
      <SiteUseForm
        control={control}
        coach={coachOf(control, design)}
        update={update}
        {...(again ? { ...close, onUsed: () => setAgain(false) } : {})}
      />
    )
  return (
    <PropertyRow label={withAi ? MATCH_ROW.rowLabel : MATCH_ROW.useRowLabel}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-1.5 text-xs text-muted-foreground"
        disabled={control.busy}
        onClick={() => setAgain(true)}
      >
        {withAi ? MATCH_ROW.again : MATCH_ROW.useAgain}
      </Button>
    </PropertyRow>
  )
}
