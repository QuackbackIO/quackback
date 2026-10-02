import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/shared/utils'

interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group. */
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * A small radio group drawn as joined text segments, for a choice between a
 * few named modes (a policy, an agent). The selected segment takes the muted fill.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const group = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const buttons = Array.from(
      group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
    )
    // Step from the option in hand: `value` lags behind while a change is still
    // being saved, so a quick second press would otherwise repeat the first.
    const focused = buttons.findIndex((button) => button === document.activeElement)
    const index = focused >= 0 ? focused : options.findIndex((option) => option.value === value)
    const nextIndex = (index + step + options.length) % options.length
    onChange(options[nextIndex]!.value)
    buttons[nextIndex]?.focus()
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5',
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 rounded-md px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              selected
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
