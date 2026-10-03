import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import {
  acceptWebsiteBrandingOfferFn,
  declineWebsiteBrandingOfferFn,
  getAutomaticWebsiteBrandingStatusFn,
  startAutomaticWebsiteBrandingFn,
  undoAutomaticWebsiteBrandingFn,
} from '@/lib/server/functions/website-branding'
import { refreshSettingsAreaQueries } from '@/components/admin/ask/settings-proposal-cache'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'

/** A running lookup is polled at most this many times per mount. */
const MAX_BRANDING_POLLS = 30
const POLL_MS = 2000

/** Poll only while a lookup is pending, and stop after a bounded number of reads. */
export function brandingPollInterval(
  data: AutomaticBrandingStatus | null | undefined,
  updates: number
): number | false {
  return data?.status === 'pending' && updates < MAX_BRANDING_POLLS ? POLL_MS : false
}

function errorCode(failure: unknown): string {
  return failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : ''
}

export function useAutomaticWebsiteBranding({ enabled }: { enabled: boolean }) {
  const session = useSessionContext()
  const router = useRouter()
  const intl = useIntl()
  const client = useQueryClient()
  const queryKey = ['onboarding', 'website-branding', session?.user.id]
  const [error, setError] = useState<string | null>(null)
  // Settings refresh only after a lookup this mount started or watched applies.
  const watched = useRef(false)
  const refreshed = useRef(false)
  const status = useQuery({
    queryKey,
    queryFn: async () => {
      const current = await getAutomaticWebsiteBrandingStatusFn()
      if (current?.status !== 'eligible') return current
      watched.current = true
      return startAutomaticWebsiteBrandingFn()
    },
    enabled: enabled && Boolean(session?.user.id),
    staleTime: 30_000,
    retry: false,
    refetchInterval: (query) => brandingPollInterval(query.state.data, query.state.dataUpdateCount),
  })
  const refresh = async () => {
    await refreshSettingsAreaQueries(client, ['branding'])
    await router.invalidate()
  }
  const failed = () =>
    intl.formatMessage({
      id: 'onboarding.branding.failed',
      defaultMessage: 'The branding could not be saved. Try again.',
    })
  useEffect(() => {
    if (status.data?.status === 'pending') watched.current = true
    if (status.data?.status !== 'applied' || !watched.current || refreshed.current) return
    refreshed.current = true
    void refresh().catch(() => setError(failed()))
  }, [status.data?.status, client, router, intl])

  const settle = async (result: AutomaticBrandingStatus | null, changed: boolean) => {
    setError(null)
    client.setQueryData(queryKey, result)
    if (changed) await refresh()
  }
  const onError = (failure: unknown) => {
    const code = errorCode(failure)
    setError(
      code === 'WEBSITE_BRANDING_UNDO_CONFLICT'
        ? intl.formatMessage({
            id: 'onboarding.branding.undoConflict',
            defaultMessage: 'The branding changed since then. Undo is unavailable.',
          })
        : code === 'WEBSITE_BRANDING_PERMISSION_REQUIRED'
          ? intl.formatMessage({
              id: 'onboarding.branding.permissionRequired',
              defaultMessage: 'Ask a workspace Owner to change the branding.',
            })
          : code === 'WEBSITE_BRANDING_UNAVAILABLE'
            ? intl.formatMessage({
                id: 'onboarding.branding.unavailable',
                defaultMessage: 'This branding change is no longer available.',
              })
            : failed()
    )
  }
  const undo = useMutation({
    mutationFn: () => undoAutomaticWebsiteBrandingFn(),
    onSuccess: (result) => settle(result, true),
    onError,
  })
  const acceptOffer = useMutation({
    mutationFn: () => acceptWebsiteBrandingOfferFn(),
    onSuccess: (result) => settle(result, true),
    onError,
  })
  const declineOffer = useMutation({
    mutationFn: () => declineWebsiteBrandingOfferFn(),
    onSuccess: (result) => settle(result, false),
    onError,
  })
  return {
    status: status.data,
    pending: undo.isPending || acceptOffer.isPending || declineOffer.isPending,
    error,
    undo: () => undo.mutate(),
    accept: () => acceptOffer.mutate(),
    dismiss: () => declineOffer.mutate(),
  }
}
