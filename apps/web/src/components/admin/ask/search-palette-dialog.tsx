import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { AskComposer } from './ask-composer'
import { AskMessages } from './ask-messages'
import { usePermissions } from '@/lib/client/use-permissions'
import {
  useBillingEnabled,
  useCloudEnabled,
  useFeatureFlags,
  usePrincipalId,
} from '@/lib/client/hooks/use-root-context'
import { buildAskDestinations, searchAskDestinations } from '@/lib/shared/ask-destinations'
import { workspaceSearchQuery } from '@/lib/client/queries/workspace-search'
import { readRecentSearches, rememberSearch, searchResultsHref } from '@/lib/client/recent-searches'

type SearchPaletteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLElement | null>
  instant?: boolean
}

export function SearchPaletteDialog(props: SearchPaletteDialogProps) {
  return (
    <AskMessages>
      <SearchPaletteDialogView {...props} />
    </AskMessages>
  )
}

/** Destinations and entity search; never starts a Copilot turn. */
function SearchPaletteDialogView({
  open,
  onOpenChange,
  returnFocus,
  instant,
}: SearchPaletteDialogProps) {
  const intl = useIntl()
  const router = useRouter()
  const principalId = usePrincipalId()
  const permissions = usePermissions()
  const featureFlags = useFeatureFlags()
  const billingEnabled = useBillingEnabled()
  const domainsEnabled = useCloudEnabled()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [semanticQuery, setSemanticQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 120)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    const timer = setTimeout(() => setSemanticQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (!open) {
      setQuery('')
      setDebouncedQuery('')
      setSemanticQuery('')
    } else setRecent(readRecentSearches(principalId))
  }, [open, principalId])
  const entitySearch = useQuery({
    ...workspaceSearchQuery(principalId, debouncedQuery, 'keyword', 4),
    enabled: open && debouncedQuery.length >= 2,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === principalId ? previous : undefined,
  })
  const semanticSearch = useQuery({
    ...workspaceSearchQuery(principalId, semanticQuery, 'semantic', 4),
    enabled: open && semanticQuery.length >= 2 && semanticQuery === query.trim(),
  })
  const options = useMemo(
    () => ({ permissions, featureFlags, billingEnabled, domainsEnabled }),
    [permissions, featureFlags, billingEnabled, domainsEnabled]
  )
  const label = (item: { messageId: string; defaultMessage: string }) =>
    intl.formatMessage({ id: item.messageId, defaultMessage: item.defaultMessage })
  const destinations = query.trim()
    ? searchAskDestinations(query, options, label)
    : buildAskDestinations(options).slice(0, 8)
  const results = [
    ...(!query.trim()
      ? recent.map((item) => ({
          id: `recent:${item}`,
          title: item,
          href: searchResultsHref(item),
          group: 'recent' as const,
        }))
      : []),
    ...destinations.map((item) => ({
      id: item.id,
      title: label(item),
      href: item.href,
      group: 'places' as const,
    })),
    ...(query.trim().length >= 2 ? (entitySearch.data?.results ?? []) : []).map((item) => ({
      ...item,
      id: `entity:${item.id}`,
      group: 'records' as const,
    })),
    ...(semanticQuery === query.trim() ? (semanticSearch.data?.results ?? []) : [])
      .filter((item) => !entitySearch.data?.results.some((row) => row.id === item.id))
      .map((item) => ({ ...item, id: `semantic:${item.id}`, group: 'semantic' as const })),
  ]
  const title = intl.formatMessage({
    id: 'ask.composer.search',
    defaultMessage: 'Search Quackback',
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        instant={instant}
        finalFocus={returnFocus}
        className="max-w-xl gap-0 p-0 [&>button]:top-3 [&>button]:right-3"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <AskComposer
          query={query}
          onQueryChange={setQuery}
          onNavigate={(href) => {
            rememberSearch(principalId, query)
            onOpenChange(false)
            void router.navigate({ href })
          }}
          onSubmitSearch={(text) => {
            rememberSearch(principalId, text)
            onOpenChange(false)
            void router.navigate({ href: searchResultsHref(text) })
          }}
          results={results}
          loading={entitySearch.isFetching}
          error={entitySearch.isError}
          stale={entitySearch.isPlaceholderData || query.trim() !== debouncedQuery}
        />
      </DialogContent>
    </Dialog>
  )
}
