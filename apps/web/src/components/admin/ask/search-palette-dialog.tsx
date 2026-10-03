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
import { searchAskEntitiesFn } from '@/lib/server/functions/ask-search'

type SearchPaletteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLElement | null>
}

export function SearchPaletteDialog(props: SearchPaletteDialogProps) {
  return (
    <AskMessages>
      <SearchPaletteDialogView {...props} />
    </AskMessages>
  )
}

/** Destinations and entity search; never starts a Copilot turn. */
function SearchPaletteDialogView({ open, onOpenChange, returnFocus }: SearchPaletteDialogProps) {
  const intl = useIntl()
  const router = useRouter()
  const principalId = usePrincipalId()
  const permissions = usePermissions()
  const featureFlags = useFeatureFlags()
  const billingEnabled = useBillingEnabled()
  const domainsEnabled = useCloudEnabled()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  const entitySearch = useQuery({
    queryKey: ['admin', 'ask', 'search', principalId, debouncedQuery],
    queryFn: () => searchAskEntitiesFn({ data: { query: debouncedQuery } }),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 30_000,
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
    ...destinations.map((item) => ({ id: item.id, title: label(item), href: item.href })),
    ...(query.trim() === debouncedQuery ? (entitySearch.data ?? []) : []).map((item) => ({
      ...item,
      id: `entity:${item.id}`,
    })),
  ]
  const title = intl.formatMessage({
    id: 'ask.composer.search',
    defaultMessage: 'Search Quackback',
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={returnFocus}
        className="max-w-xl gap-0 p-0 [&>button]:top-3 [&>button]:right-3"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <AskComposer
          query={query}
          onQueryChange={setQuery}
          onNavigate={(href) => {
            onOpenChange(false)
            void router.navigate({ href })
          }}
          results={results}
          loading={entitySearch.isFetching}
        />
      </DialogContent>
    </Dialog>
  )
}
