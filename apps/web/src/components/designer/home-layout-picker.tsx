import { useEffect } from 'react'
import {
  arrangeHome,
  HOME_LAYOUTS,
  layoutFits,
  type HomeLayout,
} from '@/lib/shared/design/home-layouts'
import { composerInHero } from '@/lib/shared/design/main-action'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { dispatcher } from './dispatcher'
import { previewOnCanvas } from './look-preview'
import { Tip } from './properties/properties-panel'

/**
 * Arrangements of Home's blocks to start from. Pointing at one or focusing it
 * shows it on the canvas; only choosing it changes the draft.
 */
export function HomeLayoutPicker({
  design,
  update,
  gates,
}: {
  design: PortalDesign
  /** Changes the draft under a name, so undo says what it takes back. */
  update: (change: (draft: PortalDesign) => void, label?: string) => void
  gates: PortalPageGates
}) {
  useEffect(() => () => previewOnCanvas(null), [])
  const arranged = (layout: HomeLayout) => {
    const next = structuredClone(design)
    next.pages.home.blocks = arrangeHome(design.pages.home.blocks, layout, gates, {
      band: composerInHero(design.pages.home),
    })
    return next
  }
  const hide = () => previewOnCanvas(null)
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label="Home layouts">
      {HOME_LAYOUTS.filter((layout) => layoutFits(layout, gates)).map((layout) => {
        const show = () => previewOnCanvas(arranged(layout))
        // The layout's blocks on Home's twelve columns, scaled to the drawing's height.
        const places = arrangeHome([], layout, gates).map((block) => block.grid)
        const rows = Math.max(1, ...places.map((place) => place.y + place.h))
        return (
          <li key={layout.id} className="flex">
            <Tip text={layout.description}>
              <button
                type="button"
                onPointerEnter={show}
                onPointerLeave={hide}
                onFocus={show}
                onBlur={hide}
                onClick={() => {
                  hide()
                  dispatcher(design, update)(
                    { op: 'home.layout', layout, gates },
                    `Home layout: ${layout.label}`
                  )
                }}
                className="flex w-full flex-col gap-1.5 rounded-md border border-border p-1.5 text-start hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  aria-hidden="true"
                  data-layout-drawing=""
                  className="relative block h-12 w-full overflow-hidden rounded-sm border border-border/60 bg-background"
                >
                  {places.map((place, index) => (
                    <span
                      key={index}
                      className="absolute rounded-sm bg-muted-foreground/30"
                      style={{
                        left: `calc(${(place.x / 12) * 100}% + 2px)`,
                        width: `calc(${(place.w / 12) * 100}% - 4px)`,
                        top: `calc(${(place.y / rows) * 100}% + 2px)`,
                        height: `calc(${(place.h / rows) * 100}% - 4px)`,
                      }}
                    />
                  ))}
                </span>
                <span className="text-xs font-medium">{layout.label}</span>
              </button>
            </Tip>
          </li>
        )
      })}
    </ul>
  )
}
