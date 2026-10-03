import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import {
  getAutomaticWebsiteBrandingStatusFn,
  startAutomaticWebsiteBrandingFn,
  undoAutomaticWebsiteBrandingFn,
} from '@/lib/server/functions/website-branding'
import { refreshSettingsAreaQueries } from '@/components/admin/ask/settings-proposal-cache'

export function useAutomaticWebsiteBranding({ enabled }: { enabled: boolean }) {
  const session = useSessionContext()
  const router = useRouter()
  const intl = useIntl()
  const client = useQueryClient()
  const queryKey = ['onboarding', 'website-branding', session?.user.id]
  const [error, setError] = useState<string | null>(null)
  const refreshed = useRef(new Set<string>())
  const status = useQuery({
    queryKey,
    queryFn: async () =>
      (await getAutomaticWebsiteBrandingStatusFn()) ?? startAutomaticWebsiteBrandingFn(),
    enabled: enabled && Boolean(session?.user.id),
    staleTime: 30_000,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' && query.state.dataUpdateCount < 60 ? 1000 : false,
  })
  const refresh = async () => {
    await refreshSettingsAreaQueries(client, ['branding'])
    await router.invalidate()
  }
  useEffect(() => {
    const id = status.data?.pendingActionId
    if (status.data?.status !== 'applied' || !id || refreshed.current.has(id)) return
    refreshed.current.add(id)
    void refresh().catch(() =>
      setError(
        intl.formatMessage({
          id: 'ask.settings.failed',
          defaultMessage: 'The changes could not be saved. Try again.',
        })
      )
    )
  }, [status.data?.status, status.data?.pendingActionId, client, router, intl])

  const undo = useMutation({
    mutationFn: () => undoAutomaticWebsiteBrandingFn(),
    onSuccess: async (result) => {
      setError(null)
      client.setQueryData(queryKey, result)
      await refresh()
    },
    onError: (failure) => {
      const code =
        failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : ''
      const copy =
        code === 'WEBSITE_BRANDING_UNDO_CONFLICT'
          ? {
              id: 'ask.settings.undoConflict',
              defaultMessage: 'These settings changed since Apply. Undo is unavailable.',
            }
          : code === 'WEBSITE_BRANDING_PERMISSION_REQUIRED'
            ? {
                id: 'ask.settings.permissionRequired',
                defaultMessage: 'Ask a workspace Owner to make this change.',
              }
            : {
                id: 'ask.settings.undoUnavailable',
                defaultMessage: 'This change cannot be undone.',
              }
      setError(intl.formatMessage(copy))
    },
  })
  return { status: status.data, pending: undo.isPending, error, undo: () => undo.mutate() }
}
