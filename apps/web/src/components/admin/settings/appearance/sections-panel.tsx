import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { WelcomeBodyEditor } from '@/components/admin/settings/branding/welcome-body-editor'
import type { TiptapContent } from '@/lib/shared/db-types'
import { ArrowTrendingUpIcon, ClockIcon, FireIcon } from '@heroicons/react/24/solid'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DesignTiles } from './design-tiles'
import {
  BandDrawing,
  CardsDrawing,
  HeaderDrawing,
  DensityDrawing,
  FiltersDrawing,
  NavDrawing,
  WidthDrawing,
} from './drawings'

type Update = (change: (draft: PortalDesign) => void) => void

const capital = (value: string) => value[0].toUpperCase() + value.slice(1)

/** The language the headline is written in here; other languages fall back to it. */
const HEADLINE_LOCALE = 'en'

/**
 * The Sections tab: the choices each part of the portal offers. Core parts
 * are restyled here, never hidden.
 */
export function SectionsPanel({ design, update }: { design: PortalDesign; update: Update }) {
  const { layout } = design
  return (
    <div className="space-y-8">
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
      </section>

      <section id="design-section-band" className="scroll-mt-4 space-y-4">
        <h3 className="text-sm font-semibold">Top band</h3>
        <DesignTiles
          name="design-band"
          label="Style"
          value={layout.band}
          columns={4}
          onChange={(band) => update((draft) => void (draft.layout.band = band))}
          options={DESIGN_OPTIONS.band.map((band) => ({
            value: band,
            label: capital(band),
            drawing: <BandDrawing band={band} />,
          }))}
        />
        {(['title', 'subtitle'] as const).map((field) => (
          <div key={field} className="space-y-1.5">
            <label htmlFor={`design-headline-${field}`} className="text-[13px] font-medium">
              {field === 'title' ? 'Headline' : 'Subtitle'}
            </label>
            <Input
              id={`design-headline-${field}`}
              value={design.pages.feedback.headline?.[field][HEADLINE_LOCALE] ?? ''}
              maxLength={280}
              onChange={(event) =>
                update((draft) => {
                  const headline = draft.pages.feedback.headline ?? { title: {}, subtitle: {} }
                  const text = event.target.value
                  if (text) headline[field][HEADLINE_LOCALE] = text
                  else delete headline[field][HEADLINE_LOCALE]
                  const empty =
                    Object.keys(headline.title).length + Object.keys(headline.subtitle).length === 0
                  draft.pages.feedback.headline = empty ? null : headline
                })
              }
            />
          </div>
        ))}
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
              drawing: <FireIcon className="size-5 text-foreground/50" />,
            },
            {
              value: 'top',
              label: 'Top',
              drawing: <ArrowTrendingUpIcon className="size-5 text-foreground/50" />,
            },
            {
              value: 'new',
              label: 'New',
              drawing: <ClockIcon className="size-5 text-foreground/50" />,
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
    </div>
  )
}
