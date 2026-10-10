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
}

export interface AskComposerProps {
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (href: string) => void
  results: readonly AskComposerResult[]
  loading?: boolean
}

/** The command palette searches destinations without starting an assistant turn. */
export function AskComposer({
  query,
  onQueryChange,
  onNavigate,
  results,
  loading = false,
}: AskComposerProps) {
  const intl = useIntl()
  const [selected, setSelected] = useState(`result:${results[0]?.id ?? ''}`)
  useEffect(() => {
    setSelected(`result:${results[0]?.id ?? ''}`)
  }, [query, results[0]?.id])
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
        {!loading && results.length === 0 && query.trim() && (
          <CommandEmpty>
            {intl.formatMessage({ id: 'ask.composer.noResults', defaultMessage: 'No results' })}
          </CommandEmpty>
        )}
      </CommandList>
    </Command>
  )
}
