import { forwardRef } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/shared/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Accessible name; defaults to the placeholder */
  'aria-label'?: string
  /** HTML data attribute for keyboard focus targeting */
  'data-search-input'?: boolean
  /** Accessible name of the clear button */
  clearLabel?: string
  /** Extra classes for the input, e.g. a pill shape */
  className?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder = 'Search...',
    'aria-label': ariaLabel,
    clearLabel = 'Clear search',
    className,
    ...props
  },
  ref
) {
  return (
    <div className="relative flex-1">
      <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        type="text"
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('pl-8 pr-8 h-8 text-sm border-border/50', className)}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
})
