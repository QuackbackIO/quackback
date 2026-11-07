import { useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'

/**
 * A number a person types. The text stays as typed: a number applies while
 * typing once it is within its bounds, and is brought within them on leaving
 * the field or pressing Enter. Blank is no value. With `stepKeys`, the arrow
 * keys step it by `step` (ten steps with Shift), from `from` while it is blank.
 */
export function NumberInput({
  value,
  min,
  max,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  stepKeys = false,
  from,
  ...input
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number | undefined
  min: number
  max: number
  onChange: (value: number | undefined) => void
  /** Whether the arrow keys step it, ten at a time with Shift. */
  stepKeys?: boolean
  /** What a step starts from while it is blank, such as the value it inherits. */
  from?: number
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [shown, setShown] = useState(value)
  const [editing, setEditing] = useState(false)
  if (value !== shown) {
    setShown(value)
    if (!editing) setText(value === undefined ? '' : String(value))
  }
  const finish = () => {
    if (text.trim() === '') return onChange(undefined)
    const number = Number(text)
    if (!Number.isFinite(number)) return setText(value === undefined ? '' : String(value))
    const kept = Math.min(max, Math.max(min, number))
    setText(String(kept))
    onChange(kept)
  }
  return (
    <Input
      {...input}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      value={text}
      onFocus={(event) => {
        setEditing(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setEditing(false)
        finish()
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish()
        if (stepKeys && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          const typed = Number(text)
          const start =
            text.trim() !== '' && Number.isFinite(typed) ? typed : (value ?? from ?? min)
          const next = stepped(start, event.key === 'ArrowUp' ? 1 : -1, {
            step: Number(input.step ?? 1),
            min,
            max,
            shift: event.shiftKey,
          })
          setText(String(next))
          onChange(next)
        }
        onKeyDown?.(event)
      }}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        if (next === '') return onChange(undefined)
        const number = Number(next)
        if (Number.isFinite(number) && number >= min && number <= max) onChange(number)
      }}
    />
  )
}

/** A value moved by whole steps (ten with Shift), kept within its bounds and to its step's precision. */
export function stepped(
  value: number,
  steps: number,
  { step, min, max, shift = false }: { step: number; min: number; max: number; shift?: boolean }
): number {
  const by = (step > 0 ? step : 1) * (shift ? 10 : 1)
  const places = Math.max(0, (String(step).split('.')[1] ?? '').length)
  const next = Number((value + steps * by).toFixed(places))
  return Math.min(max, Math.max(min, next))
}
