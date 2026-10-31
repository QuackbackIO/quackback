import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DesignTiles } from './design-tiles'
import { CardsDrawing, DensityDrawing, FiltersDrawing, NavDrawing, WidthDrawing } from './drawings'

type Update = (change: (draft: PortalDesign) => void) => void

const capital = (value: string) => value[0].toUpperCase() + value.slice(1)

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
