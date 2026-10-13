import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, Link } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { MagnifyingGlassIcon, ArrowUpRightIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePrincipalId, useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { usePermissions } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { workspaceSearchQuery } from '@/lib/client/queries/workspace-search'
import { rememberSearch, searchResultsHref } from '@/lib/client/recent-searches'
import { searchAskDestinations } from '@/lib/shared/ask-destinations'
import {
  ASK_ENTITY_KINDS,
  type AskEntityKind,
  type AskEntityResult,
} from '@/lib/shared/assistant/ask-search'
import { useCopilotHome } from './copilot-on-home'
import { AskMessages } from './ask-messages'

export function SearchResultsPage(props: { query: string; kind?: AskEntityKind }) {
  return (
    <AskMessages>
      <SearchResultsView {...props} />
    </AskMessages>
  )
}
function SearchResultsView({ query, kind }: { query: string; kind?: AskEntityKind }) {
  const intl = useIntl()
  const router = useRouter()
  const principalId = usePrincipalId()
  const permissions = usePermissions()
  const featureFlags = useFeatureFlags()
  const chat = useCopilotHome()
  const [draft, setDraft] = useState(query)
  const [limit, setLimit] = useState(10)
  useEffect(() => {
    setDraft(query)
    setLimit(10)
    rememberSearch(principalId, query)
  }, [query, principalId])
  const valid = query.length >= 2
  const keyword = useQuery({
    ...workspaceSearchQuery(principalId, query, 'keyword', limit),
    enabled: valid,
  })
  const semantic = useQuery({
    ...workspaceSearchQuery(principalId, query, 'semantic', limit),
    enabled: valid,
  })
  const label = (key: string, fallback: string) =>
    intl.formatMessage({ id: `ask.search.${key}`, defaultMessage: fallback })
  const labels: Record<AskEntityKind, string> = {
    post: label('feedback', 'Feedback'),
    conversation: label('conversations', 'Conversations'),
    ticket: label('tickets', 'Tickets'),
    article: label('articles', 'Help center'),
    changelog: label('changelog', 'Changelog'),
  }
  const allowed = ASK_ENTITY_KINDS.filter((type) =>
    type === 'post'
      ? isProductEnabled(featureFlags, 'feedback') && permissions.has(PERMISSIONS.POST_VIEW_PRIVATE)
      : type === 'conversation'
        ? !!featureFlags?.supportInbox && permissions.has(PERMISSIONS.CONVERSATION_VIEW)
        : type === 'ticket'
          ? !!featureFlags?.supportTickets && permissions.has(PERMISSIONS.TICKET_VIEW)
          : type === 'article'
            ? isProductEnabled(featureFlags, 'helpCenter') &&
              permissions.has(PERMISSIONS.HELP_CENTER_MANAGE)
            : isProductEnabled(featureFlags, 'changelog') &&
              (permissions.has(PERMISSIONS.CHANGELOG_MANAGE) ||
                permissions.has(PERMISSIONS.CHANGELOG_VIEW_DRAFT))
  )
  const places = useMemo(
    () =>
      searchAskDestinations(query, { permissions, featureFlags }, (item) =>
        intl.formatMessage({ id: item.messageId, defaultMessage: item.defaultMessage })
      ),
    [query, permissions, featureFlags, intl]
  )
  const matches = (keyword.data?.results ?? []).filter((row) => !kind || row.kind === kind)
  const similar = (semantic.data?.results ?? []).filter(
    (row) =>
      (!kind || row.kind === kind) && !keyword.data?.results.some((match) => match.id === row.id)
  )
  const loading = keyword.isFetching && !keyword.data
  return (
    <div className="min-h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
        <h1 className="text-xl font-semibold">{label('title', 'Search')}</h1>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim().length >= 2) void router.navigate({ href: searchResultsHref(draft) })
          }}
        >
          <div className="relative flex-1">
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
            />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={200}
              className="pl-9"
              aria-label={intl.formatMessage({
                id: 'ask.composer.search',
                defaultMessage: 'Search Quackback',
              })}
            />
          </div>
          <Button type="submit" disabled={draft.trim().length < 2}>
            {label('title', 'Search')}
          </Button>
        </form>
        <nav
          aria-label={label('filter', 'Filter results')}
          className="flex flex-wrap gap-1 border-b border-border pb-3"
        >
          {([undefined, ...allowed] as const).map((value) => (
            <Button
              key={value ?? 'all'}
              variant={kind === value ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={kind === value}
              onClick={() =>
                void router.navigate({
                  href: `${searchResultsHref(query)}${value ? `&kind=${value}` : ''}`,
                })
              }
            >
              {value ? labels[value] : label('all', 'All')}
            </Button>
          ))}
        </nav>
        {!valid ? (
          <p className="text-sm text-muted-foreground">
            {label('enterQuery', 'Enter at least two characters to search your workspace.')}
          </p>
        ) : (
          <>
            {!kind && places.length > 0 && (
              <section aria-label={label('places', 'Go to')} className="space-y-2">
                <h2 className="text-xs font-medium text-muted-foreground">
                  {label('places', 'Go to')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {places.slice(0, 5).map((item) => (
                    <Link
                      key={item.id}
                      to={item.href}
                      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                      <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
                      {intl.formatMessage({
                        id: item.messageId,
                        defaultMessage: item.defaultMessage,
                      })}
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {chat.state.kind === 'live' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
                <p className="text-sm">
                  {intl.formatMessage(
                    { id: 'ask.search.askAbout', defaultMessage: 'Ask AI about “{query}”' },
                    { query }
                  )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void router.navigate({ href: `/admin?ask=${encodeURIComponent(query)}` })
                  }
                >
                  {label('continueChat', 'Continue in chat')}
                </Button>
              </div>
            )}
            {loading && (
              <p role="status" className="text-sm text-muted-foreground">
                {label('searching', 'Searching…')}
              </p>
            )}
            {keyword.isError && (
              <div role="alert" className="space-y-2 text-sm">
                <p>{label('failed', 'Search could not finish. Try again.')}</p>
                <Button variant="outline" size="sm" onClick={() => void keyword.refetch()}>
                  {label('retry', 'Retry')}
                </Button>
              </div>
            )}
            {!loading && !keyword.isError && matches.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {label(
                  'noMatches',
                  'No full-text matches. Try different words or check similar meaning below.'
                )}
              </p>
            )}
            <section aria-label={label('records', 'Records')} className="divide-y divide-border">
              {matches.map((row) => (
                <SearchResultRow
                  key={row.id}
                  row={row}
                  query={query}
                  kindLabel={labels[row.kind]}
                />
              ))}
            </section>
            <section
              aria-label={label('similar', 'Similar meaning')}
              className="space-y-3 border-t pt-5"
            >
              <h2 className="text-sm font-medium">{label('similar', 'Similar meaning')}</h2>
              {semantic.isFetching && !semantic.data && (
                <p role="status" className="text-sm text-muted-foreground">
                  {label('searchingMeaning', 'Looking for similar meaning…')}
                </p>
              )}
              {semantic.data?.available === false || semantic.isError ? (
                <p className="text-sm text-muted-foreground">
                  {label(
                    'semanticUnavailable',
                    'Meaning-based search is unavailable. Full-text search still works.'
                  )}
                </p>
              ) : semantic.data && similar.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {label('noSimilar', 'No additional matches by meaning.')}
                </p>
              ) : null}
              <div className="divide-y divide-border">
                {similar.map((row) => (
                  <SearchResultRow
                    key={row.id}
                    row={row}
                    query={query}
                    kindLabel={labels[row.kind]}
                  />
                ))}
              </div>
            </section>
            {limit < 50 &&
              (keyword.data?.results.some(
                (row) =>
                  (!kind || row.kind === kind) &&
                  keyword.data!.results.filter((other) => other.kind === row.kind).length >= limit
              ) ||
                semantic.data?.results.some(
                  (row) =>
                    (!kind || row.kind === kind) &&
                    semantic.data!.results.filter((other) => other.kind === row.kind).length >=
                      limit
                )) && (
                <Button
                  variant="outline"
                  disabled={keyword.isFetching || semantic.isFetching}
                  onClick={() => setLimit((previous) => Math.min(previous + 10, 50))}
                >
                  {label('more', 'Show more results')}
                </Button>
              )}
          </>
        )}
      </div>
    </div>
  )
}

function SearchResultRow({
  row,
  query,
  kindLabel,
}: {
  row: AskEntityResult
  query: string
  kindLabel: string
}) {
  return (
    <Link
      to={row.href}
      className="block space-y-1 rounded-md px-2 py-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-xs text-muted-foreground">{kindLabel}</p>
      <p className="font-medium">
        <HighlightedText text={row.title} query={query} />
      </p>
      {row.excerpt && (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          <HighlightedText text={row.excerpt} query={query} />
        </p>
      )}
    </Link>
  )
}
function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = query
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 10)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!terms.length) return text
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi')
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 ? (
          <mark key={index} className="rounded-sm bg-primary/10 text-inherit">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}
