import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AskMessages } from './ask-messages'
import { useSearchKindLabels } from './search-labels'
import {
  useFeatureFlags,
  usePermissions,
  usePrincipalId,
} from '@/lib/client/hooks/use-root-context'
import {
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  SEARCH_PAGE_SIZE,
  queryWords,
  searchableKinds,
  searchResultsHref,
  type SearchKind,
  type SearchResult,
} from '@/lib/shared/assistant/ask-search'
import { searchWorkspaceFn } from '@/lib/server/functions/ask-search'

export interface SearchResultsPageProps {
  query: string
  kind?: SearchKind
  page?: number
}

export function SearchResultsPage(props: SearchResultsPageProps) {
  return (
    <AskMessages>
      <SearchResultsView {...props} />
    </AskMessages>
  )
}

/** The page for a query and filter; page 1 leaves the page number out. */
function pageHref(query: string, kind: SearchKind | undefined, page: number): string {
  return `${searchResultsHref(query, kind)}${page > 1 ? `&page=${page}` : ''}`
}

/**
 * Every record the viewer may open that matches the query, in one ranked
 * list (see lib/shared/assistant/ask-search.ts), with a type filter and
 * pages. Matches by meaning join in when an embedding provider is set up.
 */
function SearchResultsView({ query, kind, page = 1 }: SearchResultsPageProps) {
  const intl = useIntl()
  const router = useRouter()
  const principalId = usePrincipalId()
  const permissions = usePermissions()
  const featureFlags = useFeatureFlags()
  const labels = useSearchKindLabels()
  const [draft, setDraft] = useState(query)
  useEffect(() => setDraft(query), [query])
  // The page is opened to search, often straight from Ctrl+K, so typing goes to its box.
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const f = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id, defaultMessage }, values)

  const valid = query.length >= MIN_SEARCH_LENGTH
  const offset = (page - 1) * SEARCH_PAGE_SIZE
  const search = useQuery({
    queryKey: ['admin', 'search', principalId, query, kind ?? 'all', offset],
    queryFn: () =>
      searchWorkspaceFn({
        data: { query, kind, offset, limit: SEARCH_PAGE_SIZE, semantic: true },
      }),
    enabled: valid && offset < MAX_SEARCH_DEPTH,
    staleTime: 30_000,
  })
  const kinds = searchableKinds((permission) => permissions.has(permission), featureFlags)
  const results = search.data?.results ?? []
  const go = (href: string) => void router.navigate({ href })
  const searchLabel = f('ask.composer.search', 'Search Quackback')

  return (
    <div className="min-h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-8 sm:py-10">
        <h1 className="text-xl font-semibold">{f('ask.search.row', 'Search')}</h1>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim().length >= MIN_SEARCH_LENGTH) go(searchResultsHref(draft, kind))
          }}
        >
          <div className="relative">
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={input}
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_SEARCH_LENGTH}
              className="pl-9"
              aria-label={searchLabel}
              placeholder={searchLabel}
            />
          </div>
        </form>
        <div
          role="group"
          aria-label={f('ask.results.filterLabel', 'Filter by type')}
          className="flex flex-wrap gap-1"
        >
          {([undefined, ...kinds] as const).map((value) => (
            <Button
              key={value ?? 'all'}
              type="button"
              size="sm"
              variant={kind === value ? 'secondary' : 'ghost'}
              aria-pressed={kind === value}
              onClick={() => go(searchResultsHref(query, value))}
            >
              {value ? labels.many[value] : f('ask.results.all', 'All')}
            </Button>
          ))}
        </div>
        {!valid ? (
          <p className="text-sm text-muted-foreground">
            {f('ask.results.short', 'Type at least two characters.')}
          </p>
        ) : search.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {f('ask.results.failed', 'Search could not finish. Try again.')}
            </p>
            <Button variant="outline" size="sm" onClick={() => void search.refetch()}>
              {f('ask.results.retry', 'Try again')}
            </Button>
          </div>
        ) : search.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {f('ask.results.searching', 'Searching…')}
          </p>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {f('ask.results.empty', 'No results for “{query}”', { query })}
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {results.map((result) => (
              <li key={`${result.kind}:${result.id}`}>
                <ResultRow
                  result={result}
                  query={query}
                  title={labels.title(result)}
                  kindLabel={labels.one[result.kind]}
                />
              </li>
            ))}
          </ol>
        )}
        {valid && (page > 1 || search.data?.hasMore) && (
          <nav
            aria-label={f('ask.results.pages', 'Pages')}
            className="flex items-center justify-between gap-2"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => go(pageHref(query, kind, page - 1))}
            >
              {f('ask.results.previous', 'Previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!search.data?.hasMore}
              onClick={() => go(pageHref(query, kind, page + 1))}
            >
              {f('ask.results.next', 'Next')}
            </Button>
          </nav>
        )}
      </div>
    </div>
  )
}

function ResultRow({
  result,
  query,
  title,
  kindLabel,
}: {
  result: SearchResult
  query: string
  title: string
  kindLabel: string
}) {
  const detail = result.excerpt ?? result.subtitle
  return (
    <Link
      to={result.href}
      className="block space-y-1 rounded-md px-2 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">
          <Highlighted text={title} query={query} />
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{kindLabel}</span>
      </span>
      {detail && (
        <span className="line-clamp-2 block text-sm text-muted-foreground">
          <Highlighted text={detail} query={query} />
        </span>
      )}
    </Link>
  )
}

/** The query's words in bold, so a row shows why it matched. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const words = queryWords(query)
    .filter((word) => word.length > 1)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (words.length === 0) return text
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'))
  return (
    <>
      {parts.map((part, index) =>
        index % 2 ? (
          <mark key={index} className="bg-transparent font-semibold text-foreground">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}
