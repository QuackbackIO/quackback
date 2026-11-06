/** Email channel config mutations; each invalidates the config query. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createInboundRouteFn,
  createSendingAddressFn,
  restartSendingDomainChecksFn,
  deleteSendingDomainFn,
  deleteChannelAccountFn,
  updateInboundTrustFn,
  clearInboundForwardingFn,
  updateSendingAddressSmtpFn,
  sendTestEmailFn,
  updateSendingAddressNameFn,
  setEmailSenderFn,
  type EmailSenderChoiceDTO,
} from '@/lib/server/functions/channel-accounts'
import { emailChannelKeys } from '@/lib/client/queries/channel-accounts'

function useConfigMutation<A, R = unknown>(fn: (a: A) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailChannelKeys.config() }),
  })
}

export const useCreateInboundRoute = () =>
  useConfigMutation((forwardingTarget: string) =>
    createInboundRouteFn({ data: { forwardingTarget } })
  )

export const useCreateSendingAddress = () =>
  useConfigMutation((data: { address: string; senderName: string | null }) =>
    createSendingAddressFn({ data })
  )

export const useUpdateSendingAddressName = () =>
  useConfigMutation((data: { id: string; senderName: string | null }) =>
    updateSendingAddressNameFn({ data })
  )

/** Which address a kind of email sends from; null clears the choice. */
export const useSetEmailSender = () =>
  useConfigMutation(
    (data: {
      surface: 'default' | 'support' | 'feedback' | 'changelog' | 'status'
      choice: EmailSenderChoiceDTO | null
    }) => setEmailSenderFn({ data })
  )

export const useRestartSendingDomainChecks = () =>
  useConfigMutation((id: string) => restartSendingDomainChecksFn({ data: { id } }))

export const useDeleteSendingDomain = () =>
  useConfigMutation((id: string) => deleteSendingDomainFn({ data: { id } }))

export const useDeleteChannelAccount = () =>
  useConfigMutation((id: string) => deleteChannelAccountFn({ data: { id } }))

/** Sends a test from a live address to the person asking; changes no config. */
export const useSendTestEmail = () =>
  useMutation({
    mutationFn: (addressId: string) => sendTestEmailFn({ data: { addressId } }),
  })

export const useUpdateInboundTrust = () =>
  useConfigMutation((inboundTrust: 'strict' | 'lenient') =>
    updateInboundTrustFn({ data: { inboundTrust } })
  )

export const useClearInboundForwarding = () => useConfigMutation(() => clearInboundForwardingFn())

export const useUpdateSendingAddressSmtp = () =>
  useConfigMutation(
    (data: {
      id: string
      smtp: { host: string; port: number; secure: boolean; user: string } | null
    }) => updateSendingAddressSmtpFn({ data })
  )
