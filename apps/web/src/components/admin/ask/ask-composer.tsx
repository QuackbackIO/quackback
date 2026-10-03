import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { ArrowUpIcon, ArrowUpRightIcon, SparklesIcon } from '@heroicons/react/24/outline'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'

export interface AskComposerResult {
  id: string
  title: string
  href: string
}

export interface AskComposerProps {
  query: string
  onQueryChange: (query: string) => void
  canAsk: boolean
  onAsk: (question: string) => void
  onNavigate: (href: string) => void
  results: readonly AskComposerResult[]
  loading?: boolean
  variant?: 'home' | 'palette'
  onFocus?: () => void
}

/** Local navigation and an explicit question share one keyboard surface. */
export function AskComposer({
  query,
  onQueryChange,
  canAsk,
  onAsk,
  onNavigate,
  results,
  loading = false,
  variant = 'palette',
  onFocus,
}: AskComposerProps) {
  const intl = useIntl()
  const question = query.trim()
  const hasAsk = canAsk && question.length > 0
  const [selected, setSelected] = useState(hasAsk ? 'ask' : `result:${results[0]?.id ?? ''}`)
  useEffect(() => {
    setSelected(hasAsk ? 'ask' : `result:${results[0]?.id ?? ''}`)
  }, [question, hasAsk, results[0]?.id])

  const placeholder = canAsk
    ? intl.formatMessage({
        id: 'ask.composer.placeholder',
        defaultMessage: 'Ask or tell Quackback anything',
      })
    : intl.formatMessage({ id: 'ask.composer.search', defaultMessage: 'Search Quackback' })
  const askLabel = intl.formatMessage({ id: 'ask.composer.ask', defaultMessage: 'Ask Copilot' })

  return (
    <Command
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      className={cn('h-auto shadow-none', variant === 'home' && 'rounded-xl')}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' && hasAsk && selected === 'ask') {
          event.preventDefault()
          event.stopPropagation()
          onAsk(question)
        }
      }}
    >
      <CommandInput
        autoFocus={variant === 'palette'}
        value={query}
        onValueChange={onQueryChange}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={onFocus}
        className={variant === 'home' ? 'h-14 text-base' : undefined}
      />
      <CommandList
        aria-busy={loading}
        className={variant === 'home' && !question ? 'hidden' : undefined}
      >
        {hasAsk && (
          <CommandGroup>
            <CommandItem value="ask" onSelect={() => onAsk(question)}>
              <SparklesIcon aria-hidden="true" />
              <span>{askLabel}</span>
              <span className="min-w-0 truncate text-muted-foreground">{question}</span>
            </CommandItem>
          </CommandGroup>
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
        {!loading && !hasAsk && results.length === 0 && question && (
          <CommandEmpty>
            {intl.formatMessage({ id: 'ask.composer.noResults', defaultMessage: 'No results' })}
          </CommandEmpty>
        )}
      </CommandList>
      {variant === 'home' && (
        <div className="flex items-center justify-between gap-2 px-3 pb-3 text-xs text-muted-foreground">
          <span>
            <kbd className="me-1 rounded border border-border px-1 py-0.5">⌘K</kbd>
            {intl.formatMessage({ id: 'ask.composer.anyPage', defaultMessage: 'from any page' })}
          </span>
          {canAsk && (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="focus-visible:ring-foreground/25"
              aria-label={askLabel}
              disabled={!question}
              onClick={() => onAsk(question)}
            >
              <ArrowUpIcon className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </Command>
  )
}
