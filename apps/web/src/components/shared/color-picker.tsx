import { useState, useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/shared/utils'

/**
 * The shared color picker used by every settings surface that stores an arbitrary
 * hex color (post statuses, ticket statuses, labels): a preset grid plus a hex
 * input with a live swatch and a randomize button.
 */
export const PRESET_COLORS = [
  // Row 1 - Vibrant
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  // Row 2 - Muted
  '#f87171', // Light Red
  '#fb923c', // Light Orange
  '#facc15', // Light Yellow
  '#4ade80', // Light Green
  '#2dd4bf', // Light Teal
  '#60a5fa', // Light Blue
  '#a78bfa', // Light Violet
  '#f472b6', // Light Pink
  // Row 3 - Dark
  '#b91c1c', // Dark Red
  '#c2410c', // Dark Orange
  '#a16207', // Dark Yellow
  '#15803d', // Dark Green
  '#0f766e', // Dark Teal
  '#1d4ed8', // Dark Blue
  '#6d28d9', // Dark Violet
  '#be185d', // Dark Pink
  // Row 4 - Neutrals
  '#0f172a', // Slate 900
  '#334155', // Slate 700
  '#64748b', // Slate 500
  '#94a3b8', // Slate 400
  '#475569', // Slate 600
  '#1e293b', // Slate 800
  '#78716c', // Stone 500
  '#a8a29e', // Stone 400
]

/** A random 6-digit hex color, used to seed a fresh status or label. */
export function randomColor(): string {
  return (
    '#' +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
  )
}

interface ColorPickerGridProps {
  selectedColor: string
  onColorChange: (color: string) => void
}

/** An 8-column grid of preset swatches, the current color ringed. */
export function ColorPickerGrid({
  selectedColor,
  onColorChange,
}: ColorPickerGridProps): React.ReactElement {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={cn(
            'h-6 w-6 rounded-full border-2 transition-colors',
            selectedColor.toLowerCase() === c.toLowerCase()
              ? 'border-foreground'
              : 'border-transparent'
          )}
          style={{ backgroundColor: c }}
          onClick={() => onColorChange(c)}
        />
      ))}
    </div>
  )
}

/** A hex text input with a live preview swatch and a randomize button. */
export function ColorHexInput({
  color,
  onColorChange,
}: {
  color: string
  onColorChange: (color: string) => void
}) {
  const [hexInput, setHexInput] = useState(color)

  // Sync when color changes externally (preset click).
  useEffect(() => {
    setHexInput(color)
  }, [color])

  function handleHexChange(value: string) {
    setHexInput(value)
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      onColorChange(value)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="h-6 w-6 rounded-md border border-border shrink-0"
        style={{ backgroundColor: color }}
      />
      <Input
        value={hexInput}
        onChange={(e) => handleHexChange(e.target.value)}
        className="font-mono text-xs h-7"
        placeholder="#000000"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => {
          const c = randomColor()
          setHexInput(c)
          onColorChange(c)
        }}
        title="Random color"
      >
        <ArrowPathIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
