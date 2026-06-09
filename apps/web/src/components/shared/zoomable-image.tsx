import { useEffect, useRef, useState } from 'react'
import {
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  ArrowsPointingOutIcon,
} from '@heroicons/react/24/outline'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/shared/utils'

const MIN_SCALE = 1
const MAX_SCALE = 5
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * An image thumbnail that opens a zoom/pan lightbox on click. The modal shows
 * just the image (corner X to close) with zoom controls below it; double-click
 * toggles zoom and dragging pans when zoomed in. Shared by the composer
 * attachment tray and sent-message attachments so chat images behave the same
 * everywhere.
 */
export function ZoomableImage({
  src,
  alt,
  className,
  thumbClassName,
}: {
  src: string
  alt?: string
  /** Class for the clickable thumbnail button. */
  className?: string
  /** Class for the <img> inside the thumbnail. */
  thumbClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  // Reset the view each time the lightbox opens.
  useEffect(() => {
    if (open) {
      setScale(1)
      setOffset({ x: 0, y: 0 })
      setDragging(false)
    }
  }, [open])

  const zoomBy = (factor: number) =>
    setScale((s) => {
      const next = clamp(Number((s * factor).toFixed(2)), MIN_SCALE, MAX_SCALE)
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 })
      return next
    })
  const reset = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }
  const toggleZoom = () => (scale > 1 ? reset() : setScale(2))

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return
    setDragging(true)
    startRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const s = startRef.current
    setOffset({ x: s.ox + (e.clientX - s.x), y: s.oy + (e.clientY - s.y) })
  }
  const onPointerUp = () => setDragging(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt ? `Enlarge ${alt}` : 'Enlarge image'}
        className={className}
      >
        <img src={src} alt={alt ?? ''} loading="lazy" className={thumbClassName} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* No visible header — just the image with the built-in corner X and a
            zoom control bar below. The title stays for screen readers only. */}
        <DialogContent className="w-[92vw] max-w-[1400px] gap-2 p-3">
          <DialogTitle className="sr-only">{alt || 'Image preview'}</DialogTitle>
          <div
            className="relative flex max-h-[82vh] min-h-[55vh] flex-1 items-center justify-center overflow-hidden rounded-md bg-muted/20"
            style={{
              cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
              touchAction: 'none',
            }}
            onDoubleClick={toggleZoom}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <img
              src={src}
              alt={alt ?? ''}
              draggable={false}
              className={cn(
                'max-h-[82vh] w-auto max-w-full select-none object-contain',
                !dragging && 'transition-transform duration-150'
              )}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: 'center center',
              }}
            />
          </div>

          <div className="flex items-center justify-center gap-1 text-muted-foreground">
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.5)}
              disabled={scale <= MIN_SCALE}
              aria-label="Zoom out"
              className="flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
            >
              <MagnifyingGlassMinusIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={reset}
              aria-label="Reset zoom"
              className="flex h-8 min-w-14 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-muted"
            >
              <ArrowsPointingOutIcon className="size-3.5" />
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1.5)}
              disabled={scale >= MAX_SCALE}
              aria-label="Zoom in"
              className="flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
            >
              <MagnifyingGlassPlusIcon className="size-4" />
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
