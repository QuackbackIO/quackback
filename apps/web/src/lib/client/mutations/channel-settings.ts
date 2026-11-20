/** Autosaving channel switch: email auto-acknowledgement. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AUTOSAVE } from '@/lib/client/autosave'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'
import { updateEmailAutoAckFn } from '@/lib/server/functions/settings'

export function useUpdateEmailAutoAck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => updateEmailAutoAckFn({ data: { enabled } }),
    meta: AUTOSAVE,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: channelSettingsQueries.emailAutoAck().queryKey }),
  })
}
