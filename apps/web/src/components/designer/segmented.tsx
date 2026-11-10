import { useId } from 'react'
import { onRadioKeys, radioTabIndex } from '@/components/admin/settings/appearance/radio-keys'
import { cn } from '@/lib/shared/utils'

/**
 * A few named choices side by side under their label, the picked one filled.
 * A radio group: one Tab stop, arrows move and pick.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  rows = false,
}: {
  label: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (value: T) => void
  /** Three to a row, for more choices than a narrow panel fits on one line without cutting a name. */
  rows?: boolean
}) {
  const id = useId()
  const none = !options.some(([option]) => option === value)
  return (
    <div className="space-y-1.5">
      <span id={id} className="block text-[13px]">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={onRadioKeys}
        className={cn('gap-0.5 rounded-lg bg-muted p-0.5', rows ? 'grid grid-cols-3' : 'flex')}
      >
        {options.map(([option, name], index) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            tabIndex={radioTabIndex(value === option, none, index)}
            onClick={() => onChange(option)}
            className={cn(
              'h-7 min-w-0 flex-1 truncate rounded-md px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              value === option
                ? 'bg-background font-medium text-foreground shadow-sm forced-colors:outline forced-colors:outline-2'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}
