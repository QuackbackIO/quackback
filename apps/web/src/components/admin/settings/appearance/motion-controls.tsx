import { hoverTileOf, writeHoverTile } from '@/lib/shared/design/hover-lift'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { Update } from './section-controls'
import { Choice } from './type-shape-controls'

/**
 * What post cards, main buttons and block links do under the pointer. Lift is
 * written as post cards' and main buttons' Hover values, its one source.
 */
export function HoverControls({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <Choice
      label="Hover"
      value={hoverTileOf(design)}
      options={[
        ['none', 'None'],
        ['lift', 'Lift'],
        ['arrow', 'Arrow'],
      ]}
      onChange={(hover) => update((draft) => writeHoverTile(draft, hover))}
    />
  )
}

/** Where an inline header's menu sits; only an inline header has the choice. */
export function MenuAlignControls({ design, update }: { design: PortalDesign; update: Update }) {
  if (design.layout.header !== 'inline') return null
  return (
    <Choice
      label="Menu position"
      value={design.layout.menuAlign ?? 'start'}
      options={[
        ['start', 'Beside the logo'],
        ['centre', 'Centred'],
      ]}
      onChange={(align) =>
        update((draft) => {
          if (align === 'start') delete draft.layout.menuAlign
          else draft.layout.menuAlign = align
        })
      }
    />
  )
}
