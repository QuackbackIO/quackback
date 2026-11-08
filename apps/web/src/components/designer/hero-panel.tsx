import { useId, useRef, useState, type ReactNode } from 'react'
import { ChevronRightIcon, XMarkIcon } from '@heroicons/react/16/solid'
import {
  BandArtDrawing,
  BandDrawing,
  ImagePlaceDrawing,
} from '@/components/admin/settings/appearance/drawings'
import { FocalPoint } from '@/components/admin/settings/appearance/focal-point'
import { presignBandImage } from '@/components/admin/settings/appearance/section-controls'
import { useImageUpload } from '@/components/admin/settings/appearance/use-image-upload'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cropPhoto } from '@/lib/client/hero-photo-crop'
import { applySetting, blockOf, type SettingField } from '@/lib/shared/design/blocks'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import { designRoles } from '@/lib/shared/design/colour-roles'
import { BAND_LOOKS, type BandLook } from '@/lib/shared/design/curated'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import {
  CUSTOM_LOOK,
  heroOf,
  heroSettingShown,
  writeHero,
  type HeroBlock,
  type HeroKey,
} from '@/lib/shared/design/hero'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import { designerPages, PAGE_NAMES, type DesignerPage } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { ElementStyleEditor, SITE_STYLE } from './element-styles'
import { MainActionRows } from './hero-main-action'
import { HeroPhotoCrop } from './hero-photo-crop'
import { BackgroundRow } from './page-panel'
import { PageTitleRows } from './page-section-settings'
import {
  Help,
  PropertiesPanel,
  PropertyDrawnTiles,
  PropertyRow,
  PropertySection,
  PropertyTiles,
  type Crumb,
  type OverridePlace,
} from './properties/properties-panel'
import { ScopeLine } from './properties/scope-line'
import { colourTokens } from './properties/tokens'
import { TokenField } from './properties/token-field'
import { COLOUR_NAMES, HERO_LOOKS, HERO_TILES, HERO_WORDS, WORDS } from './properties/words'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

type Image = NonNullable<HeroBlock['image']>
type Scope = 'every' | 'page'

/** The pages whose title the hero can hold, with what sits beside it. */
const TITLED: readonly DesignerPage[] = ['changelog', 'help']

const quiet =
  'rounded text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none'

/** A look as a small drawing: its colour, with its art or its panel where it has one. */
function LookDrawing({ look }: { look: BandLook }) {
  const { band, bandArt, bandShape } = look.fields
  return (
    <span className={cn('relative block h-full w-full', bandShape === 'inset' && 'px-1 pt-0.5')}>
      <span className={cn('block h-full overflow-hidden', bandShape === 'inset' && 'rounded-sm')}>
        <BandDrawing band={band} />
      </span>
      {bandArt === 'waves' && (
        <span className="absolute inset-x-0 bottom-1 h-1 bg-[radial-gradient(circle_at_50%_0,transparent_2px,var(--background)_2.5px)] bg-[length:6px_6px]" />
      )}
    </span>
  )
}

/** A row of drawn tiles: its label above them, as they take the panel's width. */
function DrawnRow({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: ReactNode
}) {
  return (
    <div className="pt-1">
      <span className="flex min-h-6 items-center gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        {help && <Help text={help} />}
      </span>
      {children}
    </div>
  )
}

/**
 * The hero's panel on the properties frame: one scope line (the hero is the
 * same on every page; Home alone can keep an image of its own), its Look
 * with the colour it draws in and its art, its Layout, its Image, Home's
 * Main action, the rarely used rows under More, and its fill and the page's
 * background as summary rows. The words are edited on the page itself. Each
 * change is an undo step named for it, such as "Hero: Look".
 */
export function HeroPanel({
  crumbs,
  design,
  page,
  gates,
  locale,
  update,
  say,
  notes,
}: {
  crumbs: readonly Crumb[]
  design: PortalDesign
  page: DesignerPage
  /** Which pages are on: Search needs the help centre, a button to the roadmap the roadmap. */
  gates: PortalPageGates
  locale: string
  update: NamedUpdate
  say: (words: string) => void
  /** What needs looking at first, under the name: what the checks found in the hero. */
  notes?: ReactNode
}) {
  const id = useId()
  const [scope, setScope] = useState<Scope>('every')
  const def = blockOf('hero')!
  const hero = heroOf(design)
  const { layout } = design
  const home = page === 'home'
  const narrowed = scope === 'page' && home
  const shown = (key: HeroKey) => heroSettingShown(key, design, page)
  const fieldOf = (key: HeroKey) => def.fields.find((field) => field.key === key) as SettingField
  const labelOf = (key: HeroKey) => `Hero: ${fieldOf(key).label}`
  const change = (key: HeroKey, value: unknown) => {
    const result = applySetting(hero, key, value, locale)
    if (!result.ok) return say(result.refusal)
    update((draft) => writeHero(draft, result.block as HeroBlock, key), labelOf(key))
  }
  // Just this page keeps the image to Home; otherwise it shows on every page with a hero.
  const setImage = (image: HeroBlock['image']) =>
    change('image', image && narrowed ? { ...image, homeOnly: true } : image)
  const everyPageAgain = () => {
    if (!hero.image) return
    const { homeOnly: _was, ...rest } = hero.image
    change('image', rest)
  }
  const heroPages = designerPages(design, gates).filter(
    (each) => each !== 'post' && each !== 'status'
  ).length

  /** A few-way choice as tiles: set when the design stores it, Reset back to its usual value. */
  const tiles = <K extends keyof typeof HERO_TILES>(
    key: K & HeroKey,
    label: string,
    stored: string | undefined,
    fallback: keyof (typeof HERO_TILES)[K] & string,
    reset: () => void = () => change(key, fallback)
  ) => {
    const names = HERO_TILES[key] as Record<string, string>
    return (
      <PropertyRow
        label={label}
        set={stored !== undefined}
        resetLabel={`${WORDS.reset} to ${names[fallback]!.toLowerCase()}`}
        onReset={reset}
      >
        <PropertyTiles
          id={`${id}-${key}`}
          label={fieldOf(key).label}
          value={stored}
          inherited={fallback}
          options={Object.entries(names)}
          onChange={(value) => change(key, value)}
        />
      </PropertyRow>
    )
  }
  const choices = (key: HeroKey) => {
    const field = fieldOf(key)
    return field.kind === 'choice' ? field.options : []
  }

  const plainHere = !home && page !== 'feedback' && hero.titles === 'plain'
  const looks = BAND_LOOKS.filter(
    (look) => !look.needsSecond || design.brand.light.support || look.id === hero.look
  )
  const lookHelp = [
    hero.look === CUSTOM_LOOK && HERO_WORDS.customLook,
    plainHere && HERO_WORDS.plainHere,
  ].filter(Boolean) as string[]

  const look = (
    <PropertySection title={HERO_WORDS.look} help={lookHelp.join(' ') || undefined}>
      <PropertyDrawnTiles
        id={`${id}-look`}
        label={HERO_WORDS.look}
        columns={4}
        value={hero.look === CUSTOM_LOOK ? undefined : hero.look}
        options={looks.map(
          (each) =>
            [
              each.id,
              HERO_LOOKS[each.id] ?? each.label,
              <LookDrawing key={each.id} look={each} />,
            ] as const
        )}
        onChange={(value) => change('look', value)}
      />
      {shown('colour') && <ColourRow design={design} id={`${id}-colour`} change={change} />}
      {shown('art') && (
        <DrawnRow label={HERO_WORDS.art}>
          <PropertyDrawnTiles
            label={fieldOf('art').label}
            value={hero.art}
            options={choices('art').map(
              ([art, name]) =>
                [art, name, <BandArtDrawing key={art} art={art as HeroBlock['art']} />] as const
            )}
            onChange={(value) => change('art', value)}
          />
        </DrawnRow>
      )}
    </PropertySection>
  )

  const sits = hero.image && !narrowed && (
    <DrawnRow label={HERO_WORDS.sits}>
      <PropertyDrawnTiles
        label={fieldOf('imagePlace').label}
        value={hero.imagePlace}
        options={Object.entries(HERO_TILES.imagePlace).map(
          ([place, name]) =>
            [
              place,
              name,
              <ImagePlaceDrawing key={place} place={place as HeroBlock['imagePlace']} />,
            ] as const
        )}
        onChange={(value) => change('imagePlace', value)}
      />
    </DrawnRow>
  )

  const image = (
    <HeroImage
      design={design}
      image={hero.image}
      narrowed={narrowed}
      onChange={setImage}
      onEveryPage={everyPageAgain}
      onFocus={(apply) => update(apply, labelOf('image'))}
      sits={sits}
    >
      {tiles('imagePhone', HERO_WORDS.phones, layout.imagePhone, 'show')}
    </HeroImage>
  )

  const actionColour = shown('action') && (
    <PropertyRow
      label={HERO_WORDS.buttonColour}
      set={design.shape.action !== undefined}
      resetLabel={`${WORDS.reset} to ${HERO_TILES.action.buttons.toLowerCase()}`}
      onReset={() => change('action', 'buttons')}
    >
      <PropertyTiles
        label={fieldOf('action').label}
        value={design.shape.action}
        inherited="buttons"
        options={Object.entries(HERO_TILES.action)}
        onChange={(value) => change('action', value)}
      />
    </PropertyRow>
  )

  const overrides: OverridePlace[] = hero.image?.homeOnly
    ? [
        {
          key: 'image',
          label: `${PAGE_NAMES.home} page`,
          detail: `${HERO_WORDS.image.toLowerCase()}, ${HERO_WORDS.justThisPage.toLowerCase()}`,
          onReset: everyPageAgain,
        },
      ]
    : []

  const title = TITLED.includes(page) && (
    <PropertySection title={HERO_WORDS.title}>
      <PageTitleRows page={page} design={design} update={update} />
    </PropertySection>
  )

  return (
    <PropertiesPanel
      data-hero-panel=""
      className="pb-24"
      crumbs={crumbs}
      title={def.name}
      about={def.purpose}
      overrides={overrides}
      scope={
        <div className="space-y-1.5">
          {notes && <div className="space-y-1.5 text-xs">{notes}</div>}
          <ScopeLine
            one="page"
            widest={{ id: 'every', phrase: HERO_WORDS.everyPage, count: heroPages }}
            narrower={[
              {
                id: 'page',
                link: HERO_WORDS.justThisPage,
                phrase: HERO_WORDS.justThisPagePhrase,
                detail: PAGE_NAMES[page],
                disabled: home ? undefined : HERO_WORDS.onlyHome,
              },
            ]}
            value={narrowed ? 'page' : 'every'}
            onChange={setScope}
          />
        </div>
      }
    >
      {narrowed ? (
        image
      ) : (
        <>
          {look}
          <PropertySection title={HERO_WORDS.layout}>
            {tiles('height', HERO_WORDS.height, layout.bandHeight, 'roomy')}
            {tiles(
              'align',
              HERO_WORDS.align,
              layout.bandAlign,
              // Unset, the words sit as the header does.
              layout.header === 'centered' ? 'centre' : 'left',
              () => update((draft) => void delete draft.layout.bandAlign, labelOf('align'))
            )}
            {tiles('shape', HERO_WORDS.shape, layout.bandShape, 'full')}
          </PropertySection>
          {image}
          {home && (
            <PropertySection title={HERO_WORDS.mainAction}>
              <MainActionRows hero={hero} gates={gates} shown={shown} onChange={change} />
              {actionColour}
            </PropertySection>
          )}
          {title}
          <PropertySection
            more={
              <>
                {shown('glow') && tiles('glow', HERO_WORDS.glow, layout.bandGlow, 'none')}
                {shown('blend') && tiles('blend', HERO_WORDS.blend, layout.blend, 'linear')}
                {shown('fadeFrom') &&
                  tiles('fadeFrom', HERO_WORDS.fadeFrom, layout.fadeFrom, 'top')}
                {tiles('titles', HERO_WORDS.otherPages, layout.pageTitles, 'plain')}
                {!home && actionColour}
              </>
            }
          />
          <PropertySection>
            <FillRow design={design} update={update} />
            <BackgroundRow design={design} update={update} page={page} />
          </PropertySection>
        </>
      )}
    </PropertiesPanel>
  )
}

/** The colour the look draws in, as a brand colour: only the brand's own roles. */
function ColourRow({
  design,
  id,
  change,
}: {
  design: PortalDesign
  id: string
  change: (key: HeroKey, value: unknown) => void
}) {
  const roles = designRoles(design)
  const stored = design.layout.bandColour
  return (
    <PropertyRow
      label={HERO_WORDS.colour}
      htmlFor={id}
      set={stored !== undefined}
      source={WORDS.fromBrand}
      resetLabel={`${WORDS.reset} to ${COLOUR_NAMES.accent.toLowerCase()}`}
      onReset={() => change('colour', 'accent')}
    >
      <TokenField
        id={id}
        label={HERO_WORDS.colour}
        value={stored}
        inherited="accent"
        tokens={colourTokens(design, roles)}
        onChange={(value) => {
          // The hero draws in one of the brand's colours, never an exact one.
          if (value === undefined) change('colour', 'accent')
          else if ((roles as readonly string[]).includes(value)) change('colour', value)
        }}
      />
    </PropertyRow>
  )
}

/** The hero's own fill, edge, corners and shadow, as a summary that opens in place. */
function FillRow({ design, update }: { design: PortalDesign; update: NamedUpdate }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const set = Object.keys(design.style?.hero ?? {}).length > 0
  return (
    <>
      <PropertyRow label={HERO_WORDS.fillAndEdge} htmlFor={id} set={set}>
        <button
          id={id}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-settings`}
          onClick={() => setOpen(!open)}
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-start text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">
            {set ? HERO_WORDS.set : HERO_WORDS.asBrand}
          </span>
          <ChevronRightIcon
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
        </button>
      </PropertyRow>
      <div id={`${id}-settings`} hidden={!open} className="pt-1 pb-2">
        {open && (
          <ElementStyleEditor
            element="hero"
            design={design}
            update={(apply) => update(apply, 'Hero: Fill, edge and shadow')}
            scope={SITE_STYLE}
            titled={false}
          />
        )}
      </div>
    </>
  )
}

/**
 * The hero's image: "+" adds one; with one, the picture (Replace or remove
 * it), the crop from a screenshot it was cut from, its focal point, whether
 * phones show it and what it shows. An image kept to Home shows a dot, and
 * Reset shows it on every page again.
 */
function HeroImage({
  design,
  image,
  narrowed,
  onChange,
  onEveryPage,
  onFocus,
  sits,
  children,
}: {
  design: PortalDesign
  image: HeroBlock['image']
  /** Whether the panel changes this page alone, so an image set here is Home's own. */
  narrowed: boolean
  onChange: (image: HeroBlock['image']) => void
  onEveryPage: () => void
  onFocus: (apply: (draft: PortalDesign) => void) => void
  /** Where it sits, under the picture. */
  sits?: ReactNode
  /** Rows after its focal point, such as whether phones show it. */
  children?: ReactNode
}) {
  const id = useId()
  const file = useRef<HTMLInputElement>(null)
  const { busy, problem, upload } = useImageUpload(presignBandImage, (key) => onChange({ key }))
  const picker = (
    <input
      ref={file}
      id={`${id}-file`}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      aria-label={image ? HERO_WORDS.replace : MATCH_BRAND.addHeroPhoto}
      className="sr-only"
      tabIndex={-1}
      onChange={(event) => {
        const picked = event.target.files?.[0]
        event.target.value = ''
        if (picked) void upload(picked)
      }}
    />
  )
  const edit = (patch: (was: Image) => Image) => image && onChange(patch(image))
  return (
    <>
      <PropertySection
        title={HERO_WORDS.image}
        help={HERO_WORDS.imageHelp}
        onAdd={() => file.current?.click()}
        added={!!image}
      >
        {image && (
          <>
            <PropertyRow
              label={HERO_WORDS.image}
              htmlFor={`${id}-file`}
              set={!!image.homeOnly}
              source={image.homeOnly ? HERO_WORDS.justThisPage : undefined}
              resetLabel={HERO_WORDS.everyPageAgain}
              onReset={onEveryPage}
            >
              <img
                src={designAssetUrl(image.key)}
                alt=""
                className="h-6 max-w-[4.5rem] rounded border border-border bg-background object-cover"
              />
              <button
                type="button"
                className={quiet}
                disabled={busy}
                onClick={() => file.current?.click()}
              >
                {busy ? HERO_WORDS.uploading : HERO_WORDS.replace}
              </button>
              {narrowed && !image.homeOnly && (
                <button
                  type="button"
                  className={quiet}
                  onClick={() => onChange({ ...image, homeOnly: true })}
                >
                  {HERO_WORDS.justThisPage}
                </button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="ms-auto size-6"
                aria-label={HERO_WORDS.remove}
                disabled={busy}
                onClick={() => onChange(null)}
              >
                <XMarkIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </PropertyRow>
            {sits}
            <PropertyRow
              label={HERO_WORDS.focalPoint}
              help={HERO_WORDS.focalHelp}
              set={!!design.layout.imagePoint}
              resetLabel={`${WORDS.reset} ${HERO_WORDS.focalPoint.toLowerCase()}`}
              onReset={() => onFocus((draft) => void delete draft.layout.imagePoint)}
            >
              <FocalPoint design={design} update={onFocus} />
            </PropertyRow>
            {children}
            <PropertyRow label={HERO_WORDS.altText} htmlFor={`${id}-alt`} help={HERO_WORDS.altHelp}>
              <Input
                id={`${id}-alt`}
                value={image.decorative ? '' : (image.alt ?? '')}
                disabled={!!image.decorative}
                maxLength={200}
                placeholder={image.decorative ? HERO_WORDS.decorative : 'What the image shows'}
                onChange={(event) =>
                  edit(({ alt: _was, ...rest }) =>
                    event.target.value ? { ...rest, alt: event.target.value } : rest
                  )
                }
                className="h-7 min-w-0 flex-1 rounded-md px-2 text-xs md:text-xs"
              />
              <span className="flex shrink-0 items-center gap-1">
                <Checkbox
                  id={`${id}-decorative`}
                  checked={!!image.decorative}
                  onCheckedChange={(on) =>
                    edit(({ decorative: _was, ...rest }) =>
                      on === true ? { ...rest, decorative: true } : rest
                    )
                  }
                />
                <label htmlFor={`${id}-decorative`} className="text-[11px]">
                  {HERO_WORDS.decorative}
                </label>
              </span>
            </PropertyRow>
            {image.screenshot && <FromScreenshot image={image} onChange={onChange} />}
          </>
        )}
      </PropertySection>
      {/* Outside the section, so "+" can open it before there is an image. */}
      {picker}
      {problem && (
        <p role="alert" className="border-b border-border px-4 py-1.5 text-xs text-destructive">
          {problem}
        </p>
      )}
    </>
  )
}

/**
 * A hero photo cut from the customer's screenshot by a brand match: a row
 * to crop it again from the photo it came from, saying on hover that the
 * original would look better.
 */
function FromScreenshot({
  image,
  onChange,
}: {
  image: Image
  onChange: (image: HeroBlock['image']) => void
}) {
  const [cropping, setCropping] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const source = image.screenshot!
  // The box being saved, for the image the upload hands back.
  const pending = useRef<ShotBox | null>(null)
  const { busy, upload } = useImageUpload(presignBandImage, (key) => {
    setCropping(false)
    onChange({ ...image, key, screenshot: { ...source, box: pending.current ?? source.box } })
  })
  return (
    <>
      <PropertyRow label={HERO_WORDS.screenshot} help={MATCH_BRAND.fromScreenshot}>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setCropping(true)}
        >
          {MATCH_BRAND.adjustCrop}
        </Button>
      </PropertyRow>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <HeroPhotoCrop
        open={cropping}
        onOpenChange={setCropping}
        source={designAssetUrl(source.key)}
        box={source.box}
        busy={busy}
        onSave={(box) => {
          pending.current = box
          setProblem(null)
          cropPhoto(designAssetUrl(source.key), box)
            .then(upload)
            .catch(() => setProblem('The photo could not be cropped. Try again.'))
        }}
      />
    </>
  )
}
