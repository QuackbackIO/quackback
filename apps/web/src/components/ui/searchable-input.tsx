'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/shared/utils'

export interface SearchableInputOption {
  /** What gets written back to `value` when the row is picked. */
  value: string
  /** Primary text rendered in the row; defaults to `value` when omitted. */
  label?: string
  /** Optional muted right-side text (e.g. "23 people"). */
  meta?: string
}

interface SearchableInputProps {
  value: string
  onChange: (value: string) => void
  /** Async resolver — called with the current input value (after debounce). */
  fetchOptions: (query: string) => Promise<SearchableInputOption[]>
  placeholder?: string
  className?: string
  /** Debounce window in ms before `fetchOptions` runs. Default 250. */
  debounceMs?: number
  /** Cap on popover height; default 16rem (~12 rows). */
  maxHeightClassName?: string
  /** Shown when fetch returned zero rows for the current query. */
  emptyMessage?: string
  /** Shown only while the first fetch for a given session is in flight. */
  loadingMessage?: string
}

/**
 * Free-typing input with a popover of fetched suggestions below.
 *
 * The visible input IS the value field — what the user types is what
 * gets stored. The suggestion list is a shortcut, not a constraint.
 * Built on shadcn `Command` (cmdk) so rows pick up the project's
 * highlighted/hover styling, ARIA list/option semantics, and disabled
 * state for free.
 *
 * Behaviour notes (the obvious implementations have surprising bugs):
 *
 *  - Open state is authoritatively ours. Radix's `onOpenChange(false)`
 *    fires when it detects clicks on the anchor input — those are
 *    *continued engagement*, not a close — so we only react to
 *    `open=true` from Radix and drive closing via input focus / blur /
 *    escape / item-select.
 *
 *  - Option-row CommandItems use `onMouseDown preventDefault` so
 *    clicking them does NOT steal focus from the input. That keeps
 *    `onBlur` from pre-empting the click handler.
 *
 *  - `fetchOptions` is captured in a ref. Parents almost always inline
 *    the function literal, which would otherwise invalidate the effect
 *    deps every render and reset the debounce timer mid-keystroke.
 *
 *  - Stale options are preserved during a refetch (no clear-on-type)
 *    so the dropdown doesn't blank-then-refill on every character.
 *
 *  - `hasFetched` gates the empty message so we don't flash "No matches"
 *    before the first fetch has even returned.
 *
 *  - cmdk's keyboard handling normally hooks into its own CommandInput;
 *    since the value-entry input is OUTSIDE Command, we relay arrow /
 *    enter / escape by updating Command's controlled `value` prop from
 *    the outer input's onKeyDown.
 */
export function SearchableInput({
  value,
  onChange,
  fetchOptions,
  placeholder,
  className,
  debounceMs = 250,
  maxHeightClassName = 'max-h-64',
  emptyMessage = 'No matches',
  loadingMessage = 'Loading…',
}: SearchableInputProps) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<SearchableInputOption[]>([])
  const [loading, setLoading] = useState(false)
  /** Value of the cmdk-highlighted row; mirrors keyboard / hover state. */
  const [activeValue, setActiveValue] = useState<string>('')
  const [hasFetched, setHasFetched] = useState(false)

  const fetchOptionsRef = useRef(fetchOptions)
  useEffect(() => {
    fetchOptionsRef.current = fetchOptions
  }, [fetchOptions])

  // Per-effect sequence number — late-arriving responses for queries
  // the user has already typed past must not overwrite fresh state.
  const fetchSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    const seq = ++fetchSeq.current
    setLoading(true)
    const t = window.setTimeout(async () => {
      try {
        const opts = await fetchOptionsRef.current(value)
        if (seq !== fetchSeq.current) return
        setOptions(opts)
        setHasFetched(true)
      } catch {
        if (seq !== fetchSeq.current) return
        setOptions([])
        setHasFetched(true)
      } finally {
        if (seq === fetchSeq.current) setLoading(false)
      }
    }, debounceMs)
    return () => window.clearTimeout(t)
  }, [value, open, debounceMs])

  // Default the highlighted row to the first option whenever the set
  // changes, so Enter selects something predictable.
  useEffect(() => {
    setActiveValue(options[0]?.value ?? '')
  }, [options])

  const select = (opt: SearchableInputOption) => {
    onChange(opt.value)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
      }}
    >
      <PopoverAnchor asChild>
        <Input
          className={cn('h-8 text-xs', className)}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              return
            }
            if (!open || options.length === 0) return
            const idx = options.findIndex((o) => o.value === activeValue)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveValue(options[(idx + 1) % options.length].value)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveValue(options[(idx - 1 + options.length) % options.length].value)
            } else if (e.key === 'Enter' && idx >= 0) {
              e.preventDefault()
              select(options[idx])
            }
          }}
          placeholder={placeholder}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className={cn('p-0 w-(--radix-popover-anchor-width) overflow-hidden', maxHeightClassName)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false} value={activeValue} onValueChange={setActiveValue}>
          <CommandList className={cn('max-h-none', maxHeightClassName)}>
            {options.length > 0 ? (
              options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onSelect={() => select(opt)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{opt.label ?? opt.value}</span>
                  {opt.meta && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{opt.meta}</span>
                  )}
                </CommandItem>
              ))
            ) : loading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">{loadingMessage}</div>
            ) : hasFetched ? (
              <CommandEmpty className="py-2 text-xs">{emptyMessage}</CommandEmpty>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
