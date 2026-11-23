import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { hexToHsv, hsvToHex } from '@/lib/shared/theme/colour-setters'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import { parseColourInput, type Swatch } from './colours'

interface ColourPickerProps {
  /** The colour shown, as hex. */
  value: string
  swatches: Swatch[]
  /** Offer Auto (background and text). */
  allowAuto: boolean
  isAuto: boolean
  /** A new colour; `dragging` while the pointer is still down (one undo step per drag). */
  onChange: (hex: string | null, options?: { dragging?: boolean }) => void
}

/**
 * One small picker: swatches, a colour area with a hue slider, and a hex box
 * that takes the formats people paste. A drag is live in the preview.
 */
export function ColourPicker({ value, swatches, allowAuto, isAuto, onChange }: ColourPickerProps) {
  // Hue survives a trip through grey (where hex has no hue) while dragging.
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const lastSent = useRef(value)
  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value
      setHsv(hexToHsv(value))
    }
  }, [value])

  const send = (next: [number, number, number], dragging: boolean) => {
    setHsv(next)
    const hex = hsvToHex(...next)
    lastSent.current = hex
    onChange(hex, { dragging })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Suggested colours">
        {swatches.map((swatch) => (
          <button
            key={swatch.hex}
            type="button"
            title={`${swatch.name} ${swatch.hex}`}
            aria-label={`${swatch.name} ${swatch.hex}`}
            aria-pressed={!isAuto && swatch.hex === value}
            onClick={() => onChange(swatch.hex)}
            className={cn(
              'h-8 rounded-md border border-border/60 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              !isAuto && swatch.hex === value && 'ring-2 ring-foreground/70 ring-offset-1'
            )}
            style={{ backgroundColor: swatch.hex }}
          />
        ))}
      </div>

      <ColourArea hsv={hsv} onChange={send} />
      <HueSlider hsv={hsv} onChange={send} />

      <div className="flex items-start gap-2">
        <HexBox value={value} onCommit={(hex) => onChange(hex)} />
        {allowAuto ? (
          <Button
            type="button"
            variant={isAuto ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={isAuto}
            onClick={() => onChange(null)}
          >
            Auto
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Pointer drag over an element, as fractions of its width and height (0 to 1). */
function useDrag(onMove: (x: number, y: number, done: boolean) => void) {
  const dragging = useRef(false)
  const at = (event: PointerEvent<HTMLDivElement>, done: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1)))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1)))
    onMove(x, y, done)
  }
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      dragging.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      at(event, false)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (dragging.current) at(event, false)
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      dragging.current = false
      at(event, true)
    },
  }
}

type Hsv = [number, number, number]

function ColourArea({
  hsv,
  onChange,
}: {
  hsv: Hsv
  onChange: (hsv: Hsv, dragging: boolean) => void
}) {
  const [h, s, v] = hsv
  const drag = useDrag((x, y, done) => onChange([h, x, 1 - y], !done))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    const moves: Record<string, Hsv> = {
      ArrowLeft: [h, Math.max(0, s - step), v],
      ArrowRight: [h, Math.min(1, s + step), v],
      ArrowUp: [h, s, Math.min(1, v + step)],
      ArrowDown: [h, s, Math.max(0, v - step)],
    }
    const next = moves[event.key]
    if (!next) return
    event.preventDefault()
    onChange(next, true)
  }
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Colour"
      aria-valuetext={`Saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`}
      aria-valuenow={Math.round(s * 100)}
      onKeyDown={onKeyDown}
      {...drag}
      className="relative h-[120px] cursor-crosshair touch-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{
        backgroundColor: hsvToHex(h, 1, 1),
        backgroundImage:
          'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]"
        style={{
          left: `${s * 100}%`,
          top: `${(1 - v) * 100}%`,
          backgroundColor: hsvToHex(h, s, v),
        }}
      />
    </div>
  )
}

const HUE_GRADIENT =
  'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)'

function HueSlider({
  hsv,
  onChange,
}: {
  hsv: Hsv
  onChange: (hsv: Hsv, dragging: boolean) => void
}) {
  const [h, s, v] = hsv
  const drag = useDrag((x, _y, done) => onChange([Math.min(359, x * 360), s, v], !done))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 20 : 4
    const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    if (!delta) return
    event.preventDefault()
    onChange([(h + delta + 360) % 360, s, v], true)
  }
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(h)}
      onKeyDown={onKeyDown}
      {...drag}
      className="relative h-3 cursor-pointer touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{ backgroundImage: HUE_GRADIENT }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]"
        style={{ left: `${(h / 360) * 100}%`, backgroundColor: hsvToHex(h, 1, 1) }}
      />
    </div>
  )
}

/** The hex box: commits on Enter or leaving it; says how to write a colour it cannot read. */
function HexBox({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [text, setText] = useState(value)
  const [error, setError] = useState(false)
  useEffect(() => {
    setText(value)
    setError(false)
  }, [value])

  const commit = () => {
    if (text.trim() === value) return
    const hex = parseColourInput(text)
    if (!hex) {
      setError(true)
      return
    }
    setError(false)
    onCommit(hex)
  }

  return (
    <div className="min-w-0 flex-1">
      <Input
        value={text}
        aria-label="Hex code"
        aria-invalid={error || undefined}
        aria-describedby={error ? 'colour-hex-error' : undefined}
        spellCheck={false}
        className="h-8 font-mono text-[13px]"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
      />
      {error ? (
        <p id="colour-hex-error" className="mt-1 text-xs text-destructive">
          Use a hex code like #533afd.
        </p>
      ) : null}
    </div>
  )
}
