/**
 * The page background on the properties frame: the fill as drawn tiles, then
 * the fill's few settings as compact rows, dark mode as Auto, Page or its
 * own, and, for a page that can have its own, the scope line ("Changing
 * every page", with "Just Roadmap"). Colours are brand variables: a role
 * stays linked to the brand, and a colour picked by hand shows detached,
 * with a way back. Each change is one undo step named for it.
 */
import { useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronRightIcon, MinusIcon, PlusIcon } from '@heroicons/react/16/solid'
import { DesignTiles } from '@/components/admin/settings/appearance/design-tiles'
import { presignBandImage } from '@/components/admin/settings/appearance/design-update'
import { Button } from '@/components/ui/button'
import { prepareBackgroundImage, type PreparedBackground } from '@/lib/client/background-image'
import { PAGE_BACKGROUND_SETTINGS } from '@/lib/shared/design/blocks'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import { fillValue } from '@/lib/shared/design/defaults'
import {
  BACKGROUND_NAMES,
  BACKGROUND_PAGE_NAMES,
  backgroundLabel,
  backgroundOf,
  backgroundPageOf,
  imageLayer,
  patternSvg,
  siteBackground,
  withBackground,
  writeBackground,
  type BackgroundColour,
  type BackgroundFill,
  type BackgroundKind,
  type BackgroundTarget,
  type PageBackground,
} from '@/lib/shared/design/page-background'
import { resolveDesignCached } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { cn } from '@/lib/shared/utils'
import {
  PropertyMore,
  PropertyRow,
  PropertySection,
  PropertyTiles,
} from './properties/properties-panel'
import { ScopeLine } from './properties/scope-line'
import { ScrubNumber } from './properties/scrub-number'
import { TokenField } from './properties/token-field'
import { colourTokens } from './properties/tokens'
import { THEME } from './properties/words'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

type Setting = (typeof PAGE_BACKGROUND_SETTINGS)[number]
const setting = (key: string, kind?: BackgroundKind): Setting =>
  PAGE_BACKGROUND_SETTINGS.find((each) => each.key === key && (!kind || each.kinds.includes(kind)))!
const options = (key: string, kind?: BackgroundKind) =>
  (setting(key, kind).options ?? []) as ReadonlyArray<readonly [string, string]>

/** An uploaded image, stored and ready to draw. */
export interface UploadedBackground {
  key: string
  phone?: { key: string }
  tones?: [string, string]
}

/** Puts a prepared image, and its phone copy, into storage. */
async function storeBackground(file: File): Promise<UploadedBackground> {
  const prepared: PreparedBackground = await prepareBackgroundImage(file)
  const put = async (each: File) => {
    const { uploadUrl, key } = await presignBandImage(each)
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: each,
      headers: { 'Content-Type': each.type },
    })
    if (!response.ok) throw new Error(`${file.name} could not be uploaded.`)
    return key
  }
  const key = await put(prepared.full)
  const phone = prepared.phone ? await put(prepared.phone).catch(() => null) : null
  return {
    key,
    ...(phone ? { phone: { key: phone } } : {}),
    ...(prepared.tones ? { tones: prepared.tones } : {}),
  }
}

/** A kind as a small drawing, in neutral colours. */
function KindDrawing({ kind }: { kind: BackgroundKind }) {
  const style = {
    solid: 'bg-background',
    tint: 'bg-muted-foreground/25',
    gradient: 'bg-[linear-gradient(180deg,var(--muted-foreground),var(--background))] opacity-60',
    image:
      'bg-[linear-gradient(160deg,transparent_55%,var(--muted-foreground)_56%),linear-gradient(200deg,transparent_60%,var(--border)_61%)] opacity-70',
    pattern:
      'bg-[radial-gradient(var(--muted-foreground)_1px,transparent_1.5px)] bg-[length:6px_6px] opacity-60',
  }[kind]
  return <span className={cn('block h-full w-full', style)} />
}

/** A pattern's motif, drawn as it tiles. */
function PatternDrawing({ pattern }: { pattern: string }) {
  const svg = patternSvg(pattern as 'dots', '#71717a', 0.9)
  return (
    <span
      className="block h-full w-full bg-repeat"
      style={{
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        backgroundSize: '12px 12px',
      }}
    />
  )
}

/** The brand roles a background can be drawn in. */
const BACKGROUND_ROLES = DESIGN_OPTIONS.backgroundColour.filter(
  (role) => role !== 'page'
) as ReadonlyArray<'accent' | 'support' | 'extra1' | 'extra2'>

/** A background colour as a brand variable: a role's chip, or a hex shown detached. */
function BackgroundColourField({
  design,
  id,
  label,
  value,
  onChange,
}: {
  design: PortalDesign
  id: string
  label: string
  value: BackgroundColour
  onChange: (value: BackgroundColour) => void
}) {
  const tokens = useMemo(() => colourTokens(design, [...BACKGROUND_ROLES, 'page']), [design])
  return (
    <PropertyRow label={label} htmlFor={id}>
      <TokenField
        id={id}
        label={label}
        value={value}
        tokens={tokens}
        onChange={(next) => next && onChange(next as BackgroundColour)}
      />
    </PropertyRow>
  )
}

/** Tiles in a row: the row's label names the group. */
function TileRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (value: T) => void
}) {
  return (
    <PropertyRow label={label}>
      <PropertyTiles label={label} value={value} options={options} onChange={onChange} />
    </PropertyRow>
  )
}

/** An uploaded image as a row: its thumbnail, Replace and Remove, and what goes wrong. */
function BackgroundImageSlot({
  url,
  onUploaded,
  onRemove,
  upload,
}: {
  url: string | null
  onUploaded: (image: UploadedBackground) => void
  onRemove?: () => void
  upload: (file: File) => Promise<UploadedBackground>
}) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <>
      <PropertyRow label={THEME.image} htmlFor={id}>
        {url ? (
          <img src={url} alt="" className="h-7 w-11 rounded border border-border object-cover" />
        ) : (
          <span className="px-1.5 text-xs text-muted-foreground">None</span>
        )}
        <span className="ms-auto flex gap-0.5">
          {url && onRemove && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onRemove}
              disabled={busy}
            >
              Remove
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" asChild disabled={busy}>
            <label className="cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-muted-foreground">
              {busy ? THEME.uploading : url ? THEME.replace : THEME.upload}
              <input
                id={id}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  setBusy(true)
                  setProblem(null)
                  upload(file)
                    .then(onUploaded)
                    .catch((err: unknown) =>
                      setProblem(
                        err instanceof Error ? err.message : 'That file could not be uploaded.'
                      )
                    )
                    .finally(() => setBusy(false))
                }}
              />
            </label>
          </Button>
        </span>
      </PropertyRow>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </>
  )
}

/** How much of the image shows, dragged or stepped; held back where text would not read, with a mark. */
function ImageStrength({
  design,
  fill,
  onChange,
  idPrefix,
}: {
  design: PortalDesign
  fill: Extract<BackgroundFill, { kind: 'image' }>
  onChange: (strength: number) => void
  idPrefix: string
}) {
  const strength = fillValue(fill, 'strength')
  const light = useMemo(() => resolveDesignCached(design).light, [design])
  const shows = light
    ? Math.round(
        (1 -
          imageLayer(
            fill.image.tones,
            { page: light.background!, ink: light.foreground!, accent: light.primary! },
            strength
          ).alpha) *
          100
      )
    : strength
  return (
    <PropertyRow label={THEME.imageStrength} htmlFor={`${idPrefix}-strength`}>
      <ScrubNumber
        id={`${idPrefix}-strength`}
        label={THEME.imageStrength}
        value={fill.strength}
        inherited={35}
        min={0}
        max={100}
        step={5}
        unit="%"
        onChange={(next) => next !== undefined && onChange(next)}
      />
      {shows < strength && (
        <span
          role="img"
          aria-label={THEME.shownAt(shows)}
          title={THEME.shownAt(shows)}
          data-held-back=""
          className="size-1.5 shrink-0 rounded-full bg-warning"
        />
      )}
    </PropertyRow>
  )
}

/** One fill's own settings, by its kind. */
function FillSettings({
  design,
  fill,
  onChange,
  idPrefix,
  upload,
}: {
  design: PortalDesign
  fill: BackgroundFill
  /** The fill changed, with what changed in a word or two for its undo. */
  onChange: (next: BackgroundFill, words: string) => void
  idPrefix: string
  upload: (file: File) => Promise<UploadedBackground>
}) {
  const strengthOf = (kind: BackgroundKind) =>
    options('strength', kind) as ReadonlyArray<readonly ['faint' | 'soft' | 'strong', string]>
  switch (fill.kind) {
    case 'tint': {
      const exact = !(DESIGN_OPTIONS.backgroundColour as readonly string[]).includes(fill.colour)
      return (
        <>
          <BackgroundColourField
            design={design}
            id={`${idPrefix}-colour`}
            label={THEME.colour}
            value={fill.colour}
            onChange={(colour) => onChange({ ...fill, colour }, 'Colour')}
          />
          <TileRow
            label={THEME.strength}
            value={fill.strength ?? (exact ? 'given' : fillValue(fill, 'strength'))}
            options={[
              ...(exact ? [['given', THEME.asChosen] as const] : []),
              ...strengthOf('tint'),
            ]}
            onChange={(strength) => {
              const { strength: _was, ...rest } = fill
              onChange(strength === 'given' ? rest : { ...rest, strength }, 'Strength')
            }}
          />
        </>
      )
    }
    case 'gradient': {
      const radial = fillValue(fill, 'shape') === 'radial'
      return (
        <>
          <TileRow
            label="Shape"
            value={fillValue(fill, 'shape')}
            options={options('shape') as ReadonlyArray<readonly ['linear' | 'radial', string]>}
            onChange={(shape) => onChange({ ...fill, shape }, 'Shape')}
          />
          {radial ? (
            <TileRow
              label="Glow from"
              value={fillValue(fill, 'centre')}
              options={
                options('centre') as ReadonlyArray<readonly ['top' | 'middle' | 'corner', string]>
              }
              onChange={(centre) => onChange({ ...fill, centre }, 'Glow from')}
            />
          ) : (
            <TileRow
              label="Direction"
              value={fillValue(fill, 'direction')}
              options={
                options('direction') as ReadonlyArray<
                  readonly [NonNullable<typeof fill.direction>, string]
                >
              }
              onChange={(direction) => onChange({ ...fill, direction }, 'Direction')}
            />
          )}
          {fill.stops.map((stop, index) => (
            <div key={index} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <BackgroundColourField
                  design={design}
                  id={`${idPrefix}-stop-${index}`}
                  label={THEME.stop(index + 1)}
                  value={stop}
                  onChange={(colour) => {
                    const stops = [...fill.stops]
                    stops[index] = colour
                    onChange({ ...fill, stops }, 'Colours')
                  }}
                />
              </div>
              {index === 2 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 shrink-0"
                  aria-label={THEME.removeStop}
                  onClick={() => onChange({ ...fill, stops: fill.stops.slice(0, 2) }, 'Colours')}
                >
                  <MinusIcon className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          {fill.stops.length === 2 && (
            <button
              type="button"
              onClick={() => onChange({ ...fill, stops: [...fill.stops, 'page'] }, 'Colours')}
              className="flex h-7 items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {THEME.addStop}
            </button>
          )}
          <TileRow
            label={THEME.strength}
            value={fillValue(fill, 'strength')}
            options={strengthOf('gradient')}
            onChange={(strength) => onChange({ ...fill, strength }, 'Strength')}
          />
        </>
      )
    }
    case 'pattern':
      return (
        <>
          <DesignTiles
            name={`${idPrefix}-pattern`}
            label="Pattern"
            value={fill.pattern}
            columns={4}
            options={options('pattern').map(([value, label]) => ({
              value: value as typeof fill.pattern,
              label,
              drawing: <PatternDrawing pattern={value} />,
            }))}
            onChange={(pattern) => onChange({ ...fill, pattern }, 'Pattern')}
          />
          <BackgroundColourField
            design={design}
            id={`${idPrefix}-colour`}
            label={THEME.colour}
            value={fillValue(fill, 'colour')}
            onChange={(colour) => onChange({ ...fill, colour }, 'Colour')}
          />
          <TileRow
            label="Size"
            value={fillValue(fill, 'scale')}
            options={
              options('scale') as ReadonlyArray<readonly ['small' | 'medium' | 'large', string]>
            }
            onChange={(scale) => onChange({ ...fill, scale }, 'Size')}
          />
          <TileRow
            label={THEME.strength}
            value={fillValue(fill, 'strength')}
            options={strengthOf('pattern')}
            onChange={(strength) => onChange({ ...fill, strength }, 'Strength')}
          />
        </>
      )
    case 'image':
      return (
        <>
          <BackgroundImageSlot
            url={designAssetUrl(fill.image.key)}
            upload={upload}
            onUploaded={(image) => onChange({ ...fill, image }, 'Image')}
          />
          <ImageStrength
            design={design}
            fill={fill}
            idPrefix={idPrefix}
            onChange={(strength) => onChange({ ...fill, strength }, 'Image strength')}
          />
          <TileRow
            label="Fit"
            value={fillValue(fill, 'fit')}
            options={
              options('fit') as ReadonlyArray<readonly ['cover' | 'contain' | 'tile', string]>
            }
            onChange={(fit) => onChange({ ...fill, fit }, 'Fit')}
          />
          {fill.fit !== 'tile' && (
            <PropertyMore>
              <TileRow
                label="Keep in view"
                value={fillValue(fill, 'position')}
                options={
                  options('position') as ReadonlyArray<
                    readonly ['top' | 'centre' | 'bottom', string]
                  >
                }
                onChange={(position) => onChange({ ...fill, position }, 'Keep in view')}
              />
              <TileRow
                label="On scroll"
                value={fillValue(fill, 'scroll')}
                options={options('scroll') as ReadonlyArray<readonly ['scroll' | 'fixed', string]>}
                onChange={(scroll) => onChange({ ...fill, scroll }, 'On scroll')}
              />
            </PropertyMore>
          )}
        </>
      )
    default:
      return null
  }
}

/** The kinds, each a drawn tile. */
function KindTiles({
  name,
  label = 'Background',
  value,
  onChange,
  kinds = ['solid', 'tint', 'gradient', 'image', 'pattern'],
}: {
  name: string
  label?: string
  value: BackgroundKind
  onChange: (kind: BackgroundKind) => void
  kinds?: readonly BackgroundKind[]
}) {
  return (
    <DesignTiles
      name={name}
      label={label}
      value={value}
      columns={3}
      options={options('kind')
        .filter(([kind]) => kinds.includes(kind as BackgroundKind))
        .map(([kind, label]) => ({
          value: kind as BackgroundKind,
          label,
          drawing: <KindDrawing kind={kind as BackgroundKind} />,
        }))}
      onChange={onChange}
    />
  )
}

type DarkChoice = 'auto' | 'plain' | 'own'

/**
 * One target's background: its kind as drawn tiles, the kind's few
 * settings, and dark mode worked out from it, plain, or its own. Each change
 * is one undo step named for it, such as "Page background: Gradient".
 */
export function BackgroundEditor({
  design,
  update,
  target,
  upload = storeBackground,
}: {
  design: PortalDesign
  update: NamedUpdate
  target: BackgroundTarget
  upload?: (file: File) => Promise<UploadedBackground>
}) {
  const background = backgroundOf(design, target) ?? siteBackground(design)
  const { dark, ...light } = background
  const lightFill = light as BackgroundFill
  const [choosingImage, setChoosingImage] = useState(false)
  // Theme and the hero's panel may both show one; each keeps its own names.
  const idPrefix = `page-bg-${target}-${useId().replace(/[^a-z0-9]/gi, '')}`
  const write = (next: PageBackground | null, words: string) =>
    update((draft) => writeBackground(draft, target, next), backgroundLabel(target, words))
  const shownKind: BackgroundKind = choosingImage ? 'image' : lightFill.kind
  const darkChoice: DarkChoice = !dark ? 'auto' : dark.kind === 'solid' ? 'plain' : 'own'
  return (
    <div className="space-y-2">
      <KindTiles
        name={idPrefix}
        value={shownKind}
        onChange={(kind) => {
          setChoosingImage(false)
          if (kind === lightFill.kind) return
          if (kind === 'image') return setChoosingImage(true)
          write(withBackground(background, kind), BACKGROUND_NAMES[kind])
        }}
      />
      <div className="space-y-0.5">
        {choosingImage ? (
          <BackgroundImageSlot
            url={null}
            upload={upload}
            onUploaded={(image) => {
              setChoosingImage(false)
              write({ kind: 'image', image }, BACKGROUND_NAMES.image)
            }}
          />
        ) : (
          <FillSettings
            design={design}
            fill={lightFill}
            idPrefix={idPrefix}
            upload={upload}
            onChange={(next, words) =>
              write({ ...next, ...(dark ? { dark } : {}) } as PageBackground, words)
            }
          />
        )}
        {!choosingImage && (
          <TileRow
            label={THEME.darkMode}
            value={darkChoice}
            options={[
              ['auto', THEME.darkFill.auto],
              ['plain', THEME.darkFill.plain],
              ['own', THEME.darkFill.own],
            ]}
            onChange={(choice) => {
              if (choice === darkChoice) return
              const nextDark: BackgroundFill | undefined =
                choice === 'auto'
                  ? undefined
                  : choice === 'plain'
                    ? { kind: 'solid' }
                    : lightFill.kind === 'solid'
                      ? { kind: 'tint', colour: 'accent' }
                      : lightFill
              write(
                { ...lightFill, ...(nextDark ? { dark: nextDark } : {}) } as PageBackground,
                choice === 'auto'
                  ? 'automatic in dark'
                  : choice === 'plain'
                    ? 'plain in dark'
                    : 'its own in dark'
              )
            }}
          />
        )}
      </div>
      {!choosingImage && darkChoice === 'own' && dark && (
        <div className="space-y-2 border-t border-border pt-2">
          <KindTiles
            name={`${idPrefix}-dark`}
            label={THEME.darkBackground}
            value={dark.kind}
            kinds={
              lightFill.kind === 'image'
                ? ['solid', 'tint', 'gradient', 'image', 'pattern']
                : ['solid', 'tint', 'gradient', 'pattern']
            }
            onChange={(kind) => {
              const next =
                kind === 'image' ? lightFill : (withBackground(dark, kind) as BackgroundFill)
              write(
                { ...lightFill, dark: next } as PageBackground,
                `${BACKGROUND_NAMES[kind]} in dark`
              )
            }}
          />
          <div className="space-y-0.5">
            <FillSettings
              design={design}
              fill={dark}
              idPrefix={`${idPrefix}-dark`}
              upload={upload}
              onChange={(next, words) =>
                write({ ...lightFill, dark: next } as PageBackground, `${words} in dark`)
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The page background's editor: for the page the canvas shows, the scope
 * line, shared by default ("Changing every page") with "Just Roadmap" for
 * its own, then the editor for whichever it is changing.
 */
export function PageBackgroundSection({
  design,
  update,
  page,
  upload,
  heading = true,
}: {
  design: PortalDesign
  update: NamedUpdate
  /** The page the canvas shows, as the designer names it. */
  page: string | null
  upload?: (file: File) => Promise<UploadedBackground>
  /** Whether it is a titled section of its own. */
  heading?: boolean
}) {
  const own = backgroundPageOf(page)
  const hasOwn = own ? backgroundOf(design, own) !== null : false
  const target: BackgroundTarget = own && hasOwn ? own : 'site'
  const body: ReactNode = (
    <div className="space-y-3">
      {own && (
        <ScopeLine
          one="page"
          widest={{ id: 'site' as const }}
          narrower={[
            {
              id: 'page' as const,
              link: THEME.justPage(BACKGROUND_PAGE_NAMES[own]),
              phrase: THEME.pageOnly(BACKGROUND_PAGE_NAMES[own]),
            },
          ]}
          value={hasOwn ? 'page' : 'site'}
          onChange={(choice) => {
            if ((choice === 'page') === hasOwn) return
            update(
              (draft) =>
                writeBackground(draft, own, choice === 'page' ? siteBackground(design) : null),
              backgroundLabel(own, choice === 'page' ? 'This page only' : 'as every page')
            )
          }}
        />
      )}
      <BackgroundEditor
        key={target}
        design={design}
        update={update}
        target={target}
        {...(upload ? { upload } : {})}
      />
    </div>
  )
  if (!heading) return body
  return <PropertySection title={THEME.sections.pageBackground}>{body}</PropertySection>
}

/**
 * The page background as one row, for Theme and for the page's own panel:
 * whose it is and what it shows ("Every page · Gradient"), opening the
 * editor. With `onOpen`, the editor opens elsewhere, as Theme's does;
 * without, it opens in place.
 */
export function PageBackgroundEntry({
  design,
  update,
  page,
  label,
  find,
  onOpen,
}: {
  design: PortalDesign
  update: NamedUpdate
  page: string | null
  /** The row's own name, such as Background in Theme's Style; whose it is then joins the value. */
  label?: string
  /** Its stable name, which quick find shares. */
  find?: string
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const regionId = useId()
  const own = backgroundPageOf(page)
  const ownShown = own ? backgroundOf(design, own) : null
  const shown = ownShown || siteBackground(design)
  const whose = own && ownShown ? THEME.pageOnly(BACKGROUND_PAGE_NAMES[own]) : THEME.everyPage
  return (
    <div className="space-y-2" data-find={find}>
      <button
        type="button"
        aria-label={`${THEME.sections.pageBackground}: ${whose}: ${BACKGROUND_NAMES[shown.kind]}`}
        aria-expanded={onOpen ? undefined : open}
        aria-controls={onOpen ? undefined : regionId}
        onClick={() => (onOpen ? onOpen() : setOpen(!open))}
        className="flex min-h-7 w-full items-center gap-2 rounded-md text-start text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
      >
        <span className="w-[92px] shrink-0 truncate text-muted-foreground">
          {label ?? (onOpen ? whose : THEME.sections.pageBackground)}
        </span>
        <span className="min-w-0 flex-1 truncate px-1.5">
          {onOpen && !label
            ? BACKGROUND_NAMES[shown.kind]
            : `${whose}: ${BACKGROUND_NAMES[shown.kind]}`}
        </span>
        <ChevronRightIcon
          className={cn('size-3.5 text-muted-foreground', !onOpen && open && 'rotate-90')}
          aria-hidden="true"
        />
      </button>
      {!onOpen && (
        <div id={regionId} hidden={!open}>
          {open && (
            <PageBackgroundSection design={design} update={update} page={page} heading={false} />
          )}
        </div>
      )}
    </div>
  )
}
