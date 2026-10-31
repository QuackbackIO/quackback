import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { normaliseColor } from '@/lib/shared/design/color'
import { oklchToHex } from '@/lib/shared/theme/colors'

export const toHex = (value: string | undefined) =>
  value ? (value.startsWith('#') ? value : oklchToHex(value)) : '#ffffff'

/** A colour as a picker and its value; a typed value applies once it parses. */
export function ColourField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  value: string | undefined
  placeholder?: string
  onChange: (value: string | undefined) => void
}) {
  const [text, setText] = useState(value ?? '')
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(value ?? '')
  }
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-32 shrink-0 text-[13px]">
        {label}
      </label>
      <input
        type="color"
        aria-label={`${label} picker`}
        value={toHex(value ?? placeholder)}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-10 shrink-0 cursor-pointer rounded-field border border-border bg-transparent"
      />
      <Input
        id={id}
        value={text}
        placeholder={placeholder ? 'Automatic' : undefined}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (next.trim() === '' && placeholder !== undefined) onChange(undefined)
          const colour = normaliseColor(next.trim())
          if (colour) onChange(colour)
        }}
        className="h-8 font-mono text-xs"
      />
    </div>
  )
}
