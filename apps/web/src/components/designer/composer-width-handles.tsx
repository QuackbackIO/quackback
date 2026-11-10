import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { Rect } from '@/lib/shared/design/layer-geometry'
import { HANDLE, PICKED } from './grid-handles'
import type { ComposerDragView, ComposerEdge } from './use-composer-width'

/**
 * The hero composer's width handles, as the grid blocks' look: one on its
 * right edge, and with centred words one on its left too, as it grows on
 * both sides. While dragging, the width it snaps to and the composer as the
 * pointer holds it. Its height follows what is typed, so it has no height
 * handle. Shift and Left or Right step it from the keyboard.
 */
export function ComposerWidthHandles({
  box,
  centred,
  view,
  onStart,
}: {
  /** The composer's box on the layer. */
  box: Rect
  centred: boolean
  view: ComposerDragView | null
  onStart: (edge: ComposerEdge, event: ReactPointerEvent) => void
}) {
  const held = view?.lifted ?? box
  const handle = (edge: ComposerEdge, left: number) => {
    const style: CSSProperties = {
      left,
      top: held.top + held.height / 2 - 12,
      width: 8,
      height: 24,
      borderColor: PICKED,
      cursor: 'ew-resize',
    }
    return (
      <div
        key={edge}
        aria-hidden="true"
        data-resize-handle={edge}
        className={HANDLE}
        style={style}
        onPointerDown={(event) => {
          event.preventDefault()
          onStart(edge, event)
        }}
      />
    )
  }
  return (
    <>
      {view && (
        <div
          data-composer-ghost=""
          aria-hidden="true"
          className="absolute rounded-md border-2 border-dashed transition-[left,width] duration-150 ease-out motion-reduce:transition-none"
          style={{ ...view.ghost, borderColor: PICKED, background: `${PICKED}14` }}
        />
      )}
      {view && (
        <div
          data-composer-lifted=""
          aria-hidden="true"
          className="absolute rounded-md"
          style={{ ...view.lifted, outline: `2px solid ${PICKED}`, background: `${PICKED}0a` }}
        />
      )}
      {view && (
        // While dragging, the layer takes the pointer, so the page under it is not picked.
        <div
          aria-hidden="true"
          className="pointer-events-auto absolute inset-0"
          style={{ cursor: 'ew-resize' }}
        />
      )}
      {centred && handle('left', held.left - 4)}
      {handle('right', held.left + held.width - 4)}
    </>
  )
}
