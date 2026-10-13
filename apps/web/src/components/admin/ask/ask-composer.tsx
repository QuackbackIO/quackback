import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { ArrowUpRightIcon } from '@heroicons/react/24/outline'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

export interface AskComposerResult {
  id: string
  title: string
  href: string
  group?: 'places' | 'records' | 'semantic' | 'recent'
}

export interface AskComposerProps {
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (href: string) => void
  results: readonly AskComposerResult[]
  loading?: boolean
  onSubmitSearch?: (query: string) => void
  error?: boolean
  stale?: boolean
}

/** The command palette searches destinations without starting an assistant turn. */
export function AskComposer({
  query,
  onQueryChange,
  onNavigate,
  results,
  loading = false,
  onSubmitSearch,
  error = false,
  stale = false,
}: AskComposerProps) {
  const intl = useIntl()
  const defaultSelection =
    query.trim().length >= 2 && onSubmitSearch ? 'all-results' : `result:${results[0]?.id ?? ''}`
  const [selected, setSelected] = useState(defaultSelection)
  useEffect(() => {
    setSelected(defaultSelection)
  }, [query])
  useEffect(() => {
    setSelected((previous) =>
      previous === 'all-results' || results.some((item) => `result:${item.id}` === previous)
        ? previous
        : defaultSelection
    )
  }, [results, defaultSelection])
  const placeholder = intl.formatMessage({
    id: 'ask.composer.search',
    defaultMessage: 'Search Quackback',
  })

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
        {query.trim().length >= 2 && onSubmitSearch && (
          <CommandItem value="all-results" onSelect={() => onSubmitSearch(query)}>
            <ArrowUpRightIcon aria-hidden="true" />
            {intl.formatMessage(
              { id: 'ask.search.allResults', defaultMessage: 'Search all results for “{query}”' },
              { query: query.trim() }
            )}
          </CommandItem>
        )}
        {(['recent', 'places', 'records', 'semantic'] as const).map((group) => {
          const items = results.filter((result) => (result.group ?? 'places') === group)
          return (
            items.length > 0 && (
              <CommandGroup
                key={group}
                heading={intl.formatMessage(
                  group === 'places'
                    ? { id: 'ask.composer.jumpTo', defaultMessage: 'Jump to' }
                    : group === 'recent'
                      ? { id: 'ask.search.recent', defaultMessage: 'Recent searches' }
                      : group === 'semantic'
                        ? { id: 'ask.search.similar', defaultMessage: 'Similar meaning' }
                        : stale
                          ? { id: 'ask.search.previous', defaultMessage: 'Previous matches' }
                          : { id: 'ask.search.records', defaultMessage: 'Records' }
                )}
              >
                {items.map((result) => (
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
            )
          )
        })}
        {loading && (
          <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
            {intl.formatMessage({ id: 'ask.search.searching', defaultMessage: 'Searching…' })}
          </p>
        )}
        {error && (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            {intl.formatMessage({
              id: 'ask.search.failed',
              defaultMessage: 'Search could not finish. Try again.',
            })}
          </p>
        )}
        {!loading && results.length === 0 && query.trim() && (
          <CommandEmpty>
            {intl.formatMessage({ id: 'ask.composer.noResults', defaultMessage: 'No results' })}
          </CommandEmpty>
        )}
      </CommandList>
    </Command>
  )
}
