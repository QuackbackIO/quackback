/**
 * A number you drag left or right to change, Figma style. Dragging the
 * handle moves it a step every few pixels (ten steps with Shift); the arrow
 * keys step it in the field; typing commits as NumberInput does, within its
 * bounds on leaving or Enter. Unset, it shows the value it inherits, muted.
 */
import { useRef } from 'react'
import { NumberInput, stepped } from '@/components/ui/number-input'
import { cn } from '@/lib/shared/utils'

/** Pixels of drag per step. */
export const SCRUB_PX = 4

export function ScrubNumber({
  id,
  label,
  value,
  inherited,
  min,
  max,
  step = 1,
  unit,
  onChange,
  className,
}: {
  id: string
  /** Its name, for the handle's and the field's labels. */
  label: string
  value: number | undefined
  /** The value it has from wider up, shown muted while none is set here, and stepped from. */
  inherited?: number
  min: number
  max: number
  step?: number
  /** Shown after the number: "px", "em". */
  unit?: string
  onChange: (value: number | undefined) => void
  className?: string
}) {
  const drag = useRef<{ x: number; start: number; last: number } | null>(null)
  return (
    <div className={cn('flex h-7 min-w-0 flex-1 items-center rounded-md bg-muted/60', className)}>
      <span
        role="slider"
        tabIndex={-1}
        aria-label={`Drag to change ${label.toLowerCase()}`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value ?? inherited}
        title="Drag to change"
        className="flex h-full w-5 shrink-0 cursor-ew-resize touch-none items-center justify-center text-[11px] text-muted-foreground select-none"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          const start = value ?? inherited ?? min
          drag.current = { x: event.clientX, start, last: start }
        }}
        onPointerMove={(event) => {
          const at = drag.current
          if (!at) return
          const steps = Math.trunc((event.clientX - at.x) / SCRUB_PX)
          const next = stepped(at.start, steps, { step, min, max, shift: event.shiftKey })
          if (next === at.last) return
          at.last = next
          onChange(next)
        }}
        onPointerUp={(event) => {
          drag.current = null
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        ⇆
      </span>
      <NumberInput
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        stepKeys
        from={inherited}
        value={value}
        placeholder={inherited === undefined ? 'Auto' : String(+inherited.toFixed(3))}
        onChange={onChange}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none placeholder:text-muted-foreground dark:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      {unit && (
        <span className="pe-2 text-[11px] text-muted-foreground" aria-hidden="true">
          {unit}
        </span>
      )}
    </div>
  )
}
