import type { KeyboardEvent, MouseEvent } from 'react'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import type { PortalDesign } from '@/lib/shared/design/schema'

type Update = (change: (draft: PortalDesign) => void) => void
type Focus = NonNullable<PortalDesign['layout']['imageFocus']>

/** The side a point leans to, which shapes a side image. */
const sideOf = (x: number): Focus => (x < 34 ? 'left' : x > 66 ? 'right' : 'centre')
const STEP = 5
const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)))

/**
 * The hero image's focal point, picked on the image itself: a click puts it
 * there, the arrow keys nudge it. What stays in view as the hero crops.
 */
export function FocalPoint({ design, update }: { design: PortalDesign; update: Update }) {
  const image = design.brand.heroImage
  if (!image) return null
  const point = design.layout.imagePoint ?? { x: 50, y: 50 }
  const set = (x: number, y: number) =>
    update((draft) => {
      const next = { x: clamp(x), y: clamp(y) }
      draft.layout.imagePoint = next
      draft.layout.imageFocus = sideOf(next.x)
    })
  const pick = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (!box.width || !box.height) return
    set(
      ((event.clientX - box.left) / box.width) * 100,
      ((event.clientY - box.top) / box.height) * 100
    )
  }
  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    set(point.x + move[0], point.y + move[1])
  }
  return (
    <button
      type="button"
      aria-label={`Focal point, ${point.x}% across and ${point.y}% down. Click the image or use the arrow keys.`}
      onClick={pick}
      onKeyDown={nudge}
      className="relative block w-full overflow-hidden rounded-md border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <img
        src={designAssetUrl(image.key)}
        alt=""
        className="block max-h-24 w-full object-contain"
      />
      <span
        aria-hidden="true"
        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
      />
    </button>
  )
}
