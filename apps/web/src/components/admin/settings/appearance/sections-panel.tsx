import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { WelcomeBodyEditor } from '@/components/admin/settings/branding/welcome-body-editor'
import type { TiptapContent } from '@/lib/shared/db-types'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import { getBandImageUploadUrlFn } from '@/lib/server/functions/uploads'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { DesignTiles } from './design-tiles'
import { LanguagePicker } from './language-picker'
import { HomeSection } from './home-section'
import { MenuSection } from './menu-section'
import { CssSection, type CssWarning } from './css-section'
import { ImageSlot } from './image-slot'
import {
  AlignDrawing,
  BandDrawing,
  BandShapeDrawing,
  BlendDrawing,
  ImagePlaceDrawing,
  StatusDrawing,
  CardsDrawing,
  HeaderDrawing,
  DensityDrawing,
  FiltersDrawing,
  NavDrawing,
  SortDrawing,
  WidthDrawing,
} from './drawings'

type Update = (change: (draft: PortalDesign) => void) => void

const capital = (value: string) => value[0].toUpperCase() + value.slice(1)

const BAND_LABELS: Record<PortalDesign['layout']['band'], string> = {
  none: 'None',
  tint: 'Tint',
  fade: 'Fade',
  brand: 'Brand colour',
  support: 'Second colour',
  blend: 'Blend',
}

const STATUS_LABELS: Record<NonNullable<PortalDesign['layout']['status']>, string> = {
  colour: 'Coloured',
  ink: 'Text colour',
  pill: 'Tags',
  brand: 'Logo colours',
}

const presignBandImage = async (file: File) =>
  getBandImageUploadUrlFn({
    data: { filename: file.name, contentType: file.type, fileSize: file.size },
  })

/** With Home on, Home has a headline too, so the feed's says whose it is. */
const HEADLINE_LABELS = {
  title: { alone: 'Headline', withHome: 'Feedback headline' },
  subtitle: { alone: 'Subtitle', withHome: 'Feedback subtitle' },
}

/**
 * The Sections tab: the choices each part of the portal offers. Core parts
 * are restyled here, never hidden.
 */
export function SectionsPanel({
  design,
  update,
  gates,
  onEditHome,
  cssWarnings,
}: {
  design: PortalDesign
  update: Update
  /** Which pages the workspace has, for Home's starting layout and its hints. */
  gates: PortalPageGates
  /** Called when Home changes, so the preview can show it. */
  onEditHome: () => void
  /** What the CSS check warns about in the draft's CSS. */
  cssWarnings: readonly CssWarning[]
}) {
  const { layout } = design
  // The language the headline is written in; each visitor sees theirs, else the closest.
  const [headlineLocale, setHeadlineLocale] = useState<SupportedLocale>('en')
  return (
    <div className="space-y-8">
      <HomeSection design={design} update={update} gates={gates} onEdit={onEditHome} />

      <section id="design-section-header" className="scroll-mt-4 space-y-4">
        <h3 className="text-sm font-semibold">Header</h3>
        <DesignTiles
          name="design-header"
          label="Layout"
          value={layout.header}
          onChange={(header) => update((draft) => void (draft.layout.header = header))}
          options={DESIGN_OPTIONS.header.map((header) => ({
            value: header,
            label: header === 'centered' ? 'Centred' : capital(header),
            drawing: <HeaderDrawing header={header} />,
          }))}
        />
        <DesignTiles
          name="design-nav"
          label="Menu style"
          value={layout.nav}
          onChange={(nav) => update((draft) => void (draft.layout.nav = nav))}
          options={DESIGN_OPTIONS.nav.map((nav) => ({
            value: nav,
            label: capital(nav),
            drawing: <NavDrawing nav={nav} />,
          }))}
        />
        <SettingRow
          label="Header on the band"
          description={layout.band === 'none' ? 'Needs a band with colour.' : undefined}
          htmlFor="design-header-band"
          control={
            <Switch
              id="design-header-band"
              checked={layout.headerOnBand === true}
              disabled={layout.band === 'none'}
              onCheckedChange={(on) => update((draft) => void (draft.layout.headerOnBand = on))}
            />
          }
        />
      </section>

      <MenuSection design={design} update={update} gates={gates} />

      <section id="design-section-band" className="scroll-mt-4 space-y-4">
        <h3 className="text-sm font-semibold">Top band</h3>
        <DesignTiles
          name="design-band"
          label="Style"
          value={layout.band}
          onChange={(band) => update((draft) => void (draft.layout.band = band))}
          options={DESIGN_OPTIONS.band.map((band) => ({
            value: band,
            label: BAND_LABELS[band],
            drawing: <BandDrawing band={band} />,
          }))}
        />
        {layout.band === 'blend' && (
          <DesignTiles
            name="design-blend"
            label="Blend"
            value={layout.blend ?? 'linear'}
            columns={2}
            onChange={(blend) => update((draft) => void (draft.layout.blend = blend))}
            options={[
              { value: 'linear', label: 'Line', drawing: <BlendDrawing blend="linear" /> },
              { value: 'mesh', label: 'Mesh', drawing: <BlendDrawing blend="mesh" /> },
            ]}
          />
        )}
        <DesignTiles
          name="design-band-align"
          label="Words"
          value={layout.bandAlign ?? (layout.header === 'centered' ? 'centre' : 'left')}
          columns={2}
          onChange={(align) => update((draft) => void (draft.layout.bandAlign = align))}
          options={DESIGN_OPTIONS.bandAlign.map((align) => ({
            value: align,
            label: capital(align),
            drawing: <AlignDrawing align={align} />,
          }))}
        />
        <DesignTiles
          name="design-band-shape"
          label="Shape"
          value={layout.bandShape ?? 'full'}
          onChange={(shape) => update((draft) => void (draft.layout.bandShape = shape))}
          options={[
            { value: 'full', label: 'Full width', drawing: <BandShapeDrawing shape="full" /> },
            { value: 'inset', label: 'Inset', drawing: <BandShapeDrawing shape="inset" /> },
            {
              value: 'panel',
              label: 'Words on a panel',
              drawing: <BandShapeDrawing shape="panel" />,
            },
          ]}
        />
        <ImageSlot
          label="Image"
          url={design.brand.bandImage ? designAssetUrl(design.brand.bandImage.key) : null}
          accept="image/png,image/jpeg,image/webp"
          presign={presignBandImage}
          onUploaded={(key) => update((draft) => void (draft.brand.bandImage = { key }))}
          onRemove={() => update((draft) => void delete draft.brand.bandImage)}
        />
        {design.brand.bandImage && (
          <DesignTiles
            name="design-image-place"
            label="Image sits"
            value={layout.imagePlace ?? 'side'}
            columns={4}
            onChange={(place) => update((draft) => void (draft.layout.imagePlace = place))}
            options={DESIGN_OPTIONS.imagePlace.map((place) => ({
              value: place,
              label: capital(place),
              drawing: <ImagePlaceDrawing place={place} />,
            }))}
          />
        )}
        {layout.band !== 'none' && !design.pages.feedback.headline && (
          <p className="text-xs text-muted-foreground">
            The band shows behind a headline. Add one below.
          </p>
        )}
        <div className="flex justify-end">
          <LanguagePicker
            value={headlineLocale}
            onChange={setHeadlineLocale}
            label="Headline language"
          />
        </div>
        {(['title', 'subtitle'] as const).map((field) => (
          <div key={field} className="space-y-1.5">
            <label htmlFor={`design-headline-${field}`} className="text-[13px] font-medium">
              {HEADLINE_LABELS[field][design.nav.home.on ? 'withHome' : 'alone']}
            </label>
            <Input
              id={`design-headline-${field}`}
              value={design.pages.feedback.headline?.[field][headlineLocale] ?? ''}
              maxLength={280}
              onChange={(event) =>
                update((draft) => {
                  const headline = draft.pages.feedback.headline ?? { title: {}, subtitle: {} }
                  const text = event.target.value
                  if (text) headline[field][headlineLocale] = text
                  else delete headline[field][headlineLocale]
                  const empty =
                    Object.keys(headline.title).length + Object.keys(headline.subtitle).length === 0
                  draft.pages.feedback.headline = empty ? null : headline
                })
              }
            />
          </div>
        ))}
        {design.pages.feedback.headline && (
          <div className="space-y-1.5">
            <label htmlFor="design-headline-accent" className="text-[13px] font-medium">
              Phrase to set apart
            </label>
            <div className="flex gap-2">
              <Input
                id="design-headline-accent"
                value={design.pages.feedback.headline.accent?.text[headlineLocale] ?? ''}
                maxLength={60}
                placeholder="Part of the headline"
                onChange={(event) =>
                  update((draft) => {
                    const headline = draft.pages.feedback.headline
                    if (!headline) return
                    const accent = headline.accent ?? { style: 'colour' as const, text: {} }
                    const text = event.target.value
                    if (text) accent.text[headlineLocale] = text
                    else delete accent.text[headlineLocale]
                    if (Object.keys(accent.text).length) headline.accent = accent
                    else delete headline.accent
                  })
                }
              />
              <Select
                value={design.pages.feedback.headline.accent?.style ?? 'colour'}
                disabled={!design.pages.feedback.headline.accent}
                onValueChange={(style) =>
                  update((draft) => {
                    const accent = draft.pages.feedback.headline?.accent
                    if (accent) accent.style = style as 'colour' | 'highlight'
                  })
                }
              >
                <SelectTrigger className="w-36" aria-label="How the phrase is set apart">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="colour">In colour</SelectItem>
                  <SelectItem value="highlight">Highlighted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </section>

      <section id="design-section-welcome" className="scroll-mt-4 space-y-3">
        <SettingRow
          label="Welcome message"
          htmlFor="design-welcome"
          control={
            <Switch
              id="design-welcome"
              checked={design.pages.feedback.welcome.show}
              onCheckedChange={(show) =>
                update((draft) => void (draft.pages.feedback.welcome.show = show))
              }
            />
          }
        />
        {design.pages.feedback.welcome.show && (
          <WelcomeBodyEditor
            value={design.pages.feedback.welcome.body as TiptapContent}
            onChange={(body) => update((draft) => void (draft.pages.feedback.welcome.body = body))}
          />
        )}
      </section>

      <section id="design-section-feed" className="scroll-mt-4 space-y-4">
        <h3 className="text-sm font-semibold">Feed</h3>
        <DesignTiles
          name="design-cards"
          label="Cards"
          value={layout.cards}
          onChange={(cards) => update((draft) => void (draft.layout.cards = cards))}
          options={DESIGN_OPTIONS.cards.map((cards) => ({
            value: cards,
            label: capital(cards),
            drawing: <CardsDrawing cards={cards} />,
          }))}
        />
        <DesignTiles
          name="design-sort"
          label="Default sort"
          value={design.pages.feedback.defaultSort}
          onChange={(sort) => update((draft) => void (draft.pages.feedback.defaultSort = sort))}
          options={[
            {
              value: 'trending',
              label: 'Trending',
              drawing: <SortDrawing sort="trending" />,
            },
            {
              value: 'top',
              label: 'Top',
              drawing: <SortDrawing sort="top" />,
            },
            {
              value: 'new',
              label: 'New',
              drawing: <SortDrawing sort="new" />,
            },
          ]}
        />
        <DesignTiles
          name="design-density"
          label="Density"
          value={layout.density}
          onChange={(density) => update((draft) => void (draft.layout.density = density))}
          options={DESIGN_OPTIONS.density.map((density) => ({
            value: density,
            label: capital(density),
            drawing: <DensityDrawing density={density} />,
          }))}
        />
        <DesignTiles
          name="design-status"
          label="Status"
          value={layout.status ?? 'colour'}
          columns={4}
          onChange={(status) => update((draft) => void (draft.layout.status = status))}
          options={DESIGN_OPTIONS.status
            .filter((status) => status !== 'brand' || (design.brand.logoColours?.length ?? 0) > 1)
            .map((status) => ({
              value: status,
              label: STATUS_LABELS[status],
              drawing: <StatusDrawing status={status} />,
            }))}
        />
      </section>

      <section id="design-section-filters" className="scroll-mt-4 space-y-4">
        <h3 className="text-sm font-semibold">Filters</h3>
        <DesignTiles
          name="design-filters"
          label="Side"
          value={layout.filters}
          columns={2}
          onChange={(filters) => update((draft) => void (draft.layout.filters = filters))}
          options={[
            { value: 'end', label: 'Right', drawing: <FiltersDrawing filters="end" /> },
            { value: 'start', label: 'Left', drawing: <FiltersDrawing filters="start" /> },
          ]}
        />
      </section>

      <section id="design-section-site" className="scroll-mt-4 space-y-4">
        <h3 className="text-sm font-semibold">Whole site</h3>
        <DesignTiles
          name="design-width"
          label="Page width"
          value={layout.width}
          onChange={(width) => update((draft) => void (draft.layout.width = width))}
          options={DESIGN_OPTIONS.width.map((width) => ({
            value: width,
            label: capital(width),
            drawing: <WidthDrawing width={width} />,
          }))}
        />
      </section>

      <CssSection design={design} update={update} warnings={cssWarnings} />
    </div>
  )
}
