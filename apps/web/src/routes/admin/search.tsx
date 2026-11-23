import { createFileRoute } from '@tanstack/react-router'
import { SearchResultsPage } from '@/components/admin/ask/search-results-page'
import { adminPageHead } from '@/lib/client/admin-head'
import {
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_LENGTH,
  SEARCH_KINDS,
  SEARCH_PAGE_SIZE,
  type SearchKind,
} from '@/lib/shared/assistant/ask-search'

interface SearchPageSearch {
  q: string
  kind?: SearchKind
  page?: number
}

const LAST_PAGE = Math.ceil(MAX_SEARCH_DEPTH / SEARCH_PAGE_SIZE)

export const Route = createFileRoute('/admin/search')({
  head: adminPageHead('Search'),
  // Anything unknown falls back to all kinds and the first page.
  validateSearch: (search: Record<string, unknown>): SearchPageSearch => {
    const page = Number(search.page)
    return {
      q: typeof search.q === 'string' ? search.q.trim().slice(0, MAX_SEARCH_LENGTH) : '',
      // Explicit undefined, not an omitted key, so a raw bad value cannot survive.
      kind: SEARCH_KINDS.includes(search.kind as SearchKind)
        ? (search.kind as SearchKind)
        : undefined,
      page: Number.isInteger(page) && page > 1 && page <= LAST_PAGE ? page : undefined,
    }
  },
  component: SearchPage,
})

function SearchPage() {
  const { q, kind, page } = Route.useSearch()
  return <SearchResultsPage query={q} kind={kind} page={page} />
}
