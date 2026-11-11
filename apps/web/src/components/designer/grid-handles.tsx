import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Rect } from '@/lib/shared/design/layer-geometry'
import type { GridDragView, GridEdge } from './use-grid-edit'
import { CANVAS_PICKED } from './canvas-colours'

/** The picked block's colour, as the editing layer draws it. */
export const PICKED = CANVAS_PICKED

/** A resize handle's look, shared with the hero composer's. */
export const HANDLE =
  'pointer-events-auto absolute rounded-full border-2 bg-white shadow-sm touch-none ' +
  'transition-transform hover:scale-110'

/**
 * The picked Home block's resize handles, on its right edge, bottom edge and
 * bottom right corner, and while a block is dragged, the cells it lands on
 * and the block as the pointer holds it. The handles are for the pointer;
 * Shift and the arrow keys resize from the keyboard, as the grip says.
 */
export function GridHandles({
  picked,
  view,
  onStart,
}: {
  /** The picked block's box on the layer. */
  picked: Rect | null
  view: GridDragView | null
  onStart: (edge: GridEdge, event: ReactPointerEvent) => void
}) {
  const box = view?.lifted ?? picked
  const handle = (edge: Exclude<GridEdge, 'move'>, style: CSSProperties, cursor: string) => (
    <div
      key={edge}
      aria-hidden="true"
      data-resize-handle={edge}
      className={HANDLE}
      style={{ ...style, borderColor: PICKED, cursor }}
      onPointerDown={(event) => {
        event.preventDefault()
        onStart(edge, event)
      }}
    />
  )
  return (
    <>
      {view?.ghost && (
        <div
          data-grid-ghost=""
          aria-hidden="true"
          className="absolute rounded-md border-2 border-dashed transition-[left,top,width,height] duration-150 ease-out motion-reduce:transition-none"
          style={{ ...view.ghost, borderColor: PICKED, background: `${PICKED}14` }}
        />
      )}
      {view && (
        <div
          data-grid-lifted=""
          aria-hidden="true"
          className="absolute rounded-md shadow-lg"
          style={{ ...view.lifted, outline: `2px solid ${PICKED}`, background: `${PICKED}0a` }}
        />
      )}
      {view && (
        // While dragging, the layer takes the pointer, so the page under it is not picked.
        <div
          aria-hidden="true"
          className="pointer-events-auto absolute inset-0"
          style={{ cursor: view.edge === 'move' ? 'grabbing' : undefined }}
        />
      )}
      {box && (
        <>
          {handle(
            'right',
            {
              left: box.left + box.width - 4,
              top: box.top + box.height / 2 - 12,
              width: 8,
              height: 24,
            },
            'ew-resize'
          )}
          {handle(
            'bottom',
            {
              left: box.left + box.width / 2 - 12,
              top: box.top + box.height - 4,
              width: 24,
              height: 8,
            },
            'ns-resize'
          )}
          {handle(
            'corner',
            {
              left: box.left + box.width - 6,
              top: box.top + box.height - 6,
              width: 12,
              height: 12,
            },
            'nwse-resize'
          )}
        </>
      )}
    </>
  )
}
