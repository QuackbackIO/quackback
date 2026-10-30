import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { WelcomeBodyEditor } from '@/components/admin/settings/branding/welcome-body-editor'
import type { TiptapContent } from '@/lib/shared/db-types'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DesignTiles } from './design-tiles'
import {
  BandDrawing,
  CardsDrawing,
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
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Header</h3>
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

      <section className="space-y-4">
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

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="design-welcome-label" className="text-sm font-semibold">
            Welcome message
          </h3>
          <Switch
            aria-labelledby="design-welcome-label"
            checked={design.pages.feedback.welcome.show}
            onCheckedChange={(show) =>
              update((draft) => void (draft.pages.feedback.welcome.show = show))
            }
          />
        </div>
        {design.pages.feedback.welcome.show && (
          <WelcomeBodyEditor
            value={design.pages.feedback.welcome.body as TiptapContent}
            onChange={(body) => update((draft) => void (draft.pages.feedback.welcome.body = body))}
          />
        )}
      </section>

      <section className="space-y-4">
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

      <section className="space-y-4">
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

      <section className="space-y-4">
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
