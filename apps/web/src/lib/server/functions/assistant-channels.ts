/**
 * Reading and changing which customer channels Quinn answers on its own
 * (QUINN-PRODUCT P9).
 *
 * The read reports real availability rather than a switch: a workspace with no
 * inbound email route has nowhere for an autonomous reply to arrive from, and
 * saying so is more useful than offering a control that would do nothing.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

export interface AssistantEmailChannelState {
  /** Whether an inbound email route exists for a customer reply to arrive on. */
  inboundConfigured: boolean
  /** Whether the workspace has turned autonomous Quinn replies on. */
  enabled: boolean
  /** Whether Quinn is set to answer customers at all, which email also needs. */
  respondsToCustomers: boolean
}

/** The Email row's own state on the Deploy page. */
export const getAssistantEmailChannelFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AssistantEmailChannelState> => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const [{ getAssistantChannels }, { isEmailInboundConfigured }, { getMessengerConfig }] =
      await Promise.all([
        import('@/lib/server/domains/settings/settings.assistant-channels'),
        import('@/lib/server/domains/conversation/conversation.email-channel'),
        import('@/lib/server/domains/settings/settings.widget'),
      ])
    const [channels, messenger] = await Promise.all([getAssistantChannels(), getMessengerConfig()])
    return {
      inboundConfigured: isEmailInboundConfigured(),
      enabled: channels.email.enabled,
      respondsToCustomers: messenger.assistant?.respond === true,
    }
  }
)

export const updateAssistantEmailChannelFn = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { getAssistantChannels, updateAssistantChannels } =
      await import('@/lib/server/domains/settings/settings.assistant-channels')
    const current = await getAssistantChannels()
    return await updateAssistantChannels({ ...current, email: { enabled: data.enabled } })
  })
