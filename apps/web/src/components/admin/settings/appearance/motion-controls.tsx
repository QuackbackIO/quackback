import type { PortalDesign } from '@/lib/shared/design/schema'
import type { Update } from './section-controls'
import { Choice } from './type-shape-controls'

/** What buttons, post cards and block links do under the pointer. */
export function HoverControls({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <Choice
      label="Hover"
      value={design.shape.hover ?? 'none'}
      options={[
        ['none', 'None'],
        ['lift', 'Lift'],
        ['arrow', 'Arrow'],
      ]}
      onChange={(hover) =>
        update((draft) => {
          if (hover === 'none') delete draft.shape.hover
          else draft.shape.hover = hover
        })
      }
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
