import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { ArrowUpRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { MIN_SEARCH_LENGTH } from '@/lib/shared/assistant/ask-search'

export interface AskComposerResult {
  id: string
  title: string
  href: string
}

/** A record found by search, already labelled for display. */
export interface AskComposerRecord extends AskComposerResult {
  kindLabel: string
  detail?: string
}

export interface AskComposerProps {
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (href: string) => void
  /** Pages and settings to jump to. */
  results: readonly AskComposerResult[]
  /** Records matching the query, best first across every kind. */
  records?: readonly AskComposerRecord[]
  /** Opens the full results page; offered first, so Enter goes there. */
  onSubmitSearch?: (query: string) => void
  loading?: boolean
  error?: boolean
}

const ALL_RESULTS = 'all-results'

/** The command palette searches destinations and records without starting an assistant turn. */
export function AskComposer({
  query,
  onQueryChange,
  onNavigate,
  results,
  records = [],
  onSubmitSearch,
  loading = false,
  error = false,
}: AskComposerProps) {
  const intl = useIntl()
  const text = query.trim()
  const canSubmit = !!onSubmitSearch && text.length >= MIN_SEARCH_LENGTH
  const first = canSubmit ? ALL_RESULTS : `result:${results[0]?.id ?? records[0]?.id ?? ''}`
  const [selected, setSelected] = useState(first)
  useEffect(() => {
    setSelected(first)
  }, [query, first])
  const placeholder = intl.formatMessage({
    id: 'ask.composer.search',
    defaultMessage: 'Search Quackback',
  })
  const empty = !loading && !canSubmit && !!text && results.length === 0 && records.length === 0

  return (
    <Command
      label={placeholder}
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      className="h-auto shadow-none"
    >
      <CommandInput
        autoFocus
        value={query}
        onValueChange={onQueryChange}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <CommandList aria-busy={loading}>
        {canSubmit && (
          <CommandItem value={ALL_RESULTS} onSelect={() => onSubmitSearch(text)}>
            <MagnifyingGlassIcon aria-hidden="true" />
            <span className="truncate">
              {intl.formatMessage(
                { id: 'ask.results.searchFor', defaultMessage: 'Search for “{query}”' },
                { query: text }
              )}
            </span>
          </CommandItem>
        )}
        {results.length > 0 && (
          <CommandGroup
            heading={intl.formatMessage({ id: 'ask.composer.jumpTo', defaultMessage: 'Jump to' })}
          >
            {results.map((result) => (
              <CommandItem
                key={result.id}
                value={`result:${result.id}`}
                onSelect={() => onNavigate(result.href)}
              >
                <ArrowUpRightIcon aria-hidden="true" />
                <span className="truncate">{result.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {records.length > 0 && (
          <CommandGroup
            heading={intl.formatMessage({ id: 'ask.results.heading', defaultMessage: 'Results' })}
          >
            {records.map((record) => (
              <CommandItem
                key={record.id}
                value={`result:${record.id}`}
                onSelect={() => onNavigate(record.href)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{record.title}</span>
                  {record.detail && (
                    <span className="truncate text-xs text-muted-foreground">{record.detail}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{record.kindLabel}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {error && (
          <p role="alert" className="px-3 py-2 text-xs text-muted-foreground">
            {intl.formatMessage({
              id: 'ask.results.failed',
              defaultMessage: 'Search could not finish. Try again.',
            })}
          </p>
        )}
        {empty && (
          <CommandEmpty>
            {intl.formatMessage({ id: 'ask.composer.noResults', defaultMessage: 'No results' })}
          </CommandEmpty>
        )}
      </CommandList>
    </Command>
  )
}
