import { createFileRoute } from '@tanstack/react-router'
import { ASK_ENTITY_KINDS, type AskEntityKind } from '@/lib/shared/assistant/ask-search'
import { SearchResultsPage } from '@/components/admin/ask/search-results-page'

export const Route = createFileRoute('/admin/search')({
  validateSearch: (search: Record<string, unknown>): { q: string; kind?: AskEntityKind } => ({
    q: typeof search.q === 'string' ? search.q.trim().slice(0, 200) : '',
    ...(ASK_ENTITY_KINDS.includes(search.kind as AskEntityKind)
      ? { kind: search.kind as AskEntityKind }
      : {}),
  }),
  component: SearchPage,
})
function SearchPage() {
  const { q, kind } = Route.useSearch()
  return <SearchResultsPage query={q} kind={kind} />
}
