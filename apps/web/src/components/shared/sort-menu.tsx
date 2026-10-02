import { memo } from 'react'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface SortMenuProps {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}

/**
 * A small outline dropdown, "Sort: {label}", for choosing how a list is ordered.
 * Memoised so a toolbar that renders per keystroke leaves it alone; keep
 * `options` and `onChange` stable.
 */
export const SortMenu = memo(function SortMenu({ options, value, onChange }: SortMenuProps) {
  const active = options.find((o) => o.value === value) ?? options[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="whitespace-nowrap" />}
      >
        Sort: {active?.label}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
