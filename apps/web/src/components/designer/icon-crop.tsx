import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import { CROP } from './properties/words'

/** Arrow keys move the box this share of the image; with Shift they size it by twice that. */
const STEP = 0.01
/** The smallest box, as a share of the image's side. */
const MIN = 0.01

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v))

/** A box held inside the image and no smaller than the least an icon can be. */
function held(box: ShotBox): ShotBox {
  const w = clamp(box.w, MIN, 1)
  const h = clamp(box.h, MIN, 1)
  return { x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h), w, h }
}

/**
 * The part of the image shown around the box: four times its size, so a
 * small logo on a wide screenshot is large enough to frame, kept inside the image.
 */
function viewAround(box: ShotBox, aspect: number): ShotBox {
  const w = clamp(Math.max(box.w * 4, (box.h * 4) / aspect, 0.25), 0, 1)
  const h = clamp(w * aspect, 0, 1)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h }
}

/**
 * A crop box drawn on a screenshot, around the brand's mark: drag it to
 * move it, drag its corner to size it, or use the arrow keys (Shift sizes).
 * The view shows the part of the image around the box, framed when it settles.
 */
export function IconCrop({
  url,
  width,
  height,
  box,
  onChange,
}: {
  url: string
  width: number
  height: number
  box: ShotBox
  onChange: (box: ShotBox) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const aspect = height / Math.max(1, width)
  // The view follows the box only between drags, so it holds still under the pointer.
  const [anchor, setAnchor] = useState(box)
  const dragging = useRef(false)
  useEffect(() => {
    if (!dragging.current) setAnchor(box)
  }, [box])
  const view = viewAround(anchor, aspect)
  const toView = (b: ShotBox) => ({
    left: `${((b.x - view.x) / view.w) * 100}%`,
    top: `${((b.y - view.y) / view.h) * 100}%`,
    width: `${(b.w / view.w) * 100}%`,
    height: `${(b.h / view.h) * 100}%`,
  })

  const drag = (event: ReactPointerEvent, mode: 'move' | 'size') => {
    event.preventDefault()
    event.stopPropagation()
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return
    const start = { x: event.clientX, y: event.clientY, box }
    dragging.current = true
    let last = box
    const onMove = (move: PointerEvent) => {
      const dx = ((move.clientX - start.x) / rect.width) * view.w
      const dy = ((move.clientY - start.y) / rect.height) * view.h
      last = held(
        mode === 'move'
          ? { ...start.box, x: start.box.x + dx, y: start.box.y + dy }
          : { ...start.box, w: start.box.w + dx, h: start.box.h + dy }
      )
      onChange(last)
    }
    const onUp = () => {
      dragging.current = false
      setAnchor(last)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={frame}
      className="relative w-full overflow-hidden rounded-lg border border-border bg-muted"
      style={{ aspectRatio: `${view.w * width} / ${view.h * height}` }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: `${100 / view.w}%`,
          left: `${(-view.x / view.w) * 100}%`,
          top: `${(-view.y / view.h) * 100}%`,
        }}
      />
      <div
        role="group"
        tabIndex={0}
        aria-label="Icon crop box. Arrow keys move it; Shift and the arrow keys size it."
        title={CROP.hint}
        onPointerDown={(event) => drag(event, 'move')}
        onKeyDown={(event) => {
          const keys: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }
          const step = keys[event.key]
          if (!step) return
          event.preventDefault()
          const [dx, dy] = step
          onChange(
            held(
              event.shiftKey
                ? { ...box, w: box.w + dx * STEP * 2, h: box.h + dy * STEP * 2 }
                : { ...box, x: box.x + dx * STEP, y: box.y + dy * STEP }
            )
          )
        }}
        className="absolute cursor-move rounded-sm shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] outline outline-2 outline-white focus-visible:outline-muted-foreground"
        style={toView(box)}
      >
        <span
          aria-hidden="true"
          onPointerDown={(event) => drag(event, 'size')}
          className="absolute -end-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border border-border bg-white"
        />
      </div>
    </div>
  )
}
