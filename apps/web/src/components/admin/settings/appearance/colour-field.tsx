import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { normaliseColor } from '@/lib/shared/design/color'
import { oklchToHex } from '@/lib/shared/theme/colors'
import type { BrandSwatch } from '@/lib/shared/design/colour-roles'

export const toHex = (value: string | undefined) =>
  value ? (value.startsWith('#') ? value : oklchToHex(value)) : '#ffffff'

/** A typed colour as a value, taking hex without its # too, or null when it is not one. */
export function typedColour(text: string): string | null {
  const trimmed = text.trim()
  return normaliseColor(/^([0-9a-f]{3}){1,2}$/i.test(trimmed) ? `#${trimmed}` : trimmed)
}

/** Swatches as hex, each colour once, by name where it has one, up to eight. */
function named(
  swatches: ReadonlyArray<string | BrandSwatch>
): Array<{ colour: string; name?: string }> {
  const seen = new Map<string, { colour: string; name?: string }>()
  for (const swatch of swatches) {
    const { colour, name } =
      typeof swatch === 'string' ? { colour: swatch, name: undefined } : swatch
    const hex = toHex(colour)
    if (!seen.has(hex)) seen.set(hex, { colour: hex, name })
  }
  return [...seen.values()].slice(0, 8)
}

/** Whether typing could still be under way: a short hex such as #abc may be the start of #abcdef. */
const mayGrow = (text: string) => /^#?[0-9a-f]{0,5}$/i.test(text.trim())

/**
 * A colour as a picker and its value. A typed value applies while typing once
 * it is complete, and on leaving the field or pressing Enter otherwise; one
 * that is not a colour says so and is not used.
 */
export function ColourField({
  id,
  label,
  value,
  placeholder,
  swatches,
  onChange,
}: {
  id: string
  label: string
  value: string | undefined
  placeholder?: string
  /** The brand's own colours, each a click away, by name where they have one. */
  swatches?: ReadonlyArray<string | BrandSwatch>
  onChange: (value: string | undefined) => void
}) {
  const [text, setText] = useState(value ?? '')
  const [shown, setShown] = useState(value)
  const [editing, setEditing] = useState(false)
  const [wrong, setWrong] = useState(false)
  if (value !== shown) {
    setShown(value)
    if (!editing) setText(value ?? '')
  }
  const finish = () => {
    if (text.trim() === '' && placeholder !== undefined) {
      setWrong(false)
      return onChange(undefined)
    }
    const colour = typedColour(text)
    setWrong(!colour)
    if (colour) {
      onChange(colour)
      setText(colour)
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="w-32 shrink-0 text-[13px]">
          {label}
        </label>
        <span className="relative shrink-0">
          <input
            type="color"
            aria-label={`${label} picker`}
            value={toHex(value ?? placeholder)}
            onChange={(event) => onChange(event.target.value)}
            className="block h-8 w-10 cursor-pointer rounded-field border border-border bg-transparent"
          />
          {/* Unset with nothing to fall back to: striped, not a white that is not there. */}
          {value === undefined && placeholder === undefined && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-1 rounded-sm bg-[repeating-linear-gradient(45deg,var(--muted)_0_4px,var(--background)_4px_8px)]"
            />
          )}
        </span>
        <Input
          id={id}
          value={text}
          placeholder={placeholder ? 'Automatic' : undefined}
          aria-invalid={wrong || undefined}
          aria-describedby={wrong ? `${id}-wrong` : undefined}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            finish()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finish()
          }}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            setWrong(false)
            if (next.trim() === '' && placeholder !== undefined) return onChange(undefined)
            const colour = mayGrow(next) ? null : typedColour(next)
            if (colour) onChange(colour)
          }}
          className="h-8 font-mono text-xs"
        />
      </div>
      {swatches && swatches.length > 0 && (
        <div role="group" aria-label={`${label}: brand colours`} className="ms-34 flex gap-1">
          {named(swatches).map(({ colour: swatch, name }) => (
            <button
              key={swatch}
              type="button"
              aria-label={name ? `Use ${name}, ${swatch}` : `Use ${swatch}`}
              title={name ? `${name} ${swatch}` : swatch}
              onClick={() => {
                setText(swatch)
                setWrong(false)
                onChange(swatch)
              }}
              className="size-5 rounded border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              style={{ background: swatch }}
            />
          ))}
        </div>
      )}
      {wrong && (
        <p id={`${id}-wrong`} role="alert" className="ms-34 text-xs text-destructive">
          Not a colour. Use a hex value such as #1d4ed8.
        </p>
      )}
    </div>
  )
}
