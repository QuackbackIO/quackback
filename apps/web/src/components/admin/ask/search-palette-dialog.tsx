import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { AskComposer } from './ask-composer'
import { AskMessages } from './ask-messages'
import { useSearchKindLabels } from './search-labels'
import {
  useBillingEnabled,
  useFeatureFlags,
  usePrincipalId,
  usePermissions,
} from '@/lib/client/hooks/use-root-context'
import { buildAskDestinations, searchAskDestinations } from '@/lib/shared/ask-destinations'
import { MIN_SEARCH_LENGTH, searchResultsHref } from '@/lib/shared/assistant/ask-search'
import { searchWorkspaceFn } from '@/lib/server/functions/ask-search'

type SearchPaletteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLElement | null>
}

/** How many records the palette lists; Enter opens the full list. */
const PALETTE_RECORDS = 8

export function SearchPaletteDialog(props: SearchPaletteDialogProps) {
  return (
    <AskMessages>
      <SearchPaletteDialogView {...props} />
    </AskMessages>
  )
}

/**
 * Destinations and records the viewer may open, ranked across kinds by the
 * server. Full text only, so it answers as you type; the results page adds
 * matches by meaning. Never starts a Copilot turn.
 */
function SearchPaletteDialogView({ open, onOpenChange, returnFocus }: SearchPaletteDialogProps) {
  const intl = useIntl()
  const router = useRouter()
  const principalId = usePrincipalId()
  const permissions = usePermissions()
  const featureFlags = useFeatureFlags()
  const billingEnabled = useBillingEnabled()
  const labels = useSearchKindLabels()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 150)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  const recordSearch = useQuery({
    queryKey: ['admin', 'search', principalId, debouncedQuery, 'palette'],
    queryFn: () => searchWorkspaceFn({ data: { query: debouncedQuery, limit: PALETTE_RECORDS } }),
    enabled: open && debouncedQuery.length >= MIN_SEARCH_LENGTH,
    staleTime: 30_000,
  })
  const options = useMemo(
    () => ({ permissions, featureFlags, billingEnabled }),
    [permissions, featureFlags, billingEnabled]
  )
  const label = (item: { messageId: string; defaultMessage: string }) =>
    intl.formatMessage({ id: item.messageId, defaultMessage: item.defaultMessage })
  const destinations = query.trim()
    ? searchAskDestinations(query, options, label).slice(0, 4)
    : buildAskDestinations(options).slice(0, 8)
  const current = query.trim() === debouncedQuery && query.trim().length >= MIN_SEARCH_LENGTH
  const records = (current ? (recordSearch.data?.results ?? []) : []).map((result) => ({
    id: `${result.kind}:${result.id}`,
    title: labels.title(result),
    href: result.href,
    kindLabel: labels.one[result.kind],
    detail: result.subtitle ?? result.excerpt,
  }))
  const title = intl.formatMessage({
    id: 'ask.composer.search',
    defaultMessage: 'Search Quackback',
  })
  // Opening a result moves focus to the new page, not back to where Ctrl+K was pressed.
  const navigated = useRef(false)
  const go = (href: string) => {
    navigated.current = true
    onOpenChange(false)
    void router.navigate({ href })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={() => {
          if (!navigated.current) return returnFocus.current ?? true
          navigated.current = false
          return false
        }}
        className="max-w-xl gap-0 p-0 [&>button]:top-3 [&>button]:right-3"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <AskComposer
          query={query}
          onQueryChange={setQuery}
          onNavigate={go}
          onSubmitSearch={(text) => go(searchResultsHref(text))}
          results={destinations.map((item) => ({
            id: item.id,
            title: label(item),
            href: item.href,
          }))}
          records={records}
          loading={recordSearch.isFetching}
          error={current && recordSearch.isError}
        />
      </DialogContent>
    </Dialog>
  )
}
