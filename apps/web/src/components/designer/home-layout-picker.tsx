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
        // The layout's blocks on Home's twelve columns, a row of the drawing to each of theirs.
        const places = arrangeHome([], layout, gates).map((block) => block.grid)
        return (
          <li key={layout.id}>
            <button
              type="button"
              title={layout.description}
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
              <span aria-hidden="true" className="grid grid-cols-12 gap-x-0.5 [grid-auto-rows:2px]">
                {places.map((place, index) => (
                  <span
                    key={index}
                    className="mb-0.5 rounded-[2px] bg-muted-foreground/30"
                    style={{
                      gridColumn: `${place.x + 1} / span ${place.w}`,
                      gridRow: `${place.y + 1} / span ${place.h}`,
                    }}
                  />
                ))}
              </span>
              <span className="text-xs font-medium">{layout.label}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
