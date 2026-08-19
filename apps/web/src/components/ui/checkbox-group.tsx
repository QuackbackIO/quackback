'use client'

import { Checkbox } from '@/components/ui/checkbox'

export interface CheckboxGroupItem {
  value: string
  label: React.ReactNode
  /** When present, the item renders as a bordered row with the description below the label. */
  description?: string
  /** Accessible label for the checkbox when the visible label alone is not descriptive. */
  ariaLabel?: string
}

interface CheckboxGroupProps {
  items: CheckboxGroupItem[]
  selected: string[]
  onToggle: (value: string) => void
  disabled?: boolean
  /** Container layout (e.g. a grid for compact items, space-y for rows). */
  className?: string
}

/**
 * A multi-select checkbox list (API key scopes, webhook event subscriptions).
 * Items with a description render as bordered rows; items without render as
 * compact inline labels.
 */
export function CheckboxGroup({
  items,
  selected,
  onToggle,
  disabled,
  className,
}: CheckboxGroupProps) {
  return (
    <div className={className}>
      {items.map((item) =>
        item.description ? (
          <label
            key={item.value}
            className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <Checkbox
              checked={selected.includes(item.value)}
              onCheckedChange={() => onToggle(item.value)}
              disabled={disabled}
              className="mt-0.5"
              aria-label={item.ariaLabel}
            />
            <div>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
          </label>
        ) : (
          <label
            key={item.value}
            className="flex items-center gap-2 text-sm cursor-pointer"
            htmlFor={`checkbox-group-${item.value}`}
          >
            <Checkbox
              id={`checkbox-group-${item.value}`}
              checked={selected.includes(item.value)}
              onCheckedChange={() => onToggle(item.value)}
              disabled={disabled}
              aria-label={item.ariaLabel}
            />
            <span>{item.label}</span>
          </label>
        )
      )}
    </div>
  )
}
