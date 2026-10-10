import { createServerFn } from '@tanstack/react-start'
import {
  sendMessageSchema,
  conversationIdSchema,
  listMessagesSchema,
  myConversationSchema,
  csatSchema,
} from '@/lib/shared/schemas/conversation'

export const widgetSendConversationMessageFn = createServerFn({ method: 'POST' })
  .validator(sendMessageSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runSendConversationMessage } = await import('../conversation')
    return runSendConversationMessage(await requireWidgetAuth(), data)
  })

export const widgetGetConversationPresenceFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { runGetConversationPresence } = await import('../conversation')
    return runGetConversationPresence()
  }
)

export const widgetGetTeamAvatarsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { runGetWidgetTeamAvatars } = await import('../conversation')
  return runGetWidgetTeamAvatars()
})

export const widgetGetMyConversationFn = createServerFn({ method: 'GET' })
  .validator(myConversationSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runGetMyConversation } = await import('../conversation')
    return runGetMyConversation(await getOptionalWidgetAuth(), data)
  })

export const widgetGetMyConversationsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getOptionalWidgetAuth } = await import('../widget-auth')
  const { runGetMyConversations } = await import('../conversation')
  return runGetMyConversations(await getOptionalWidgetAuth())
})

export const widgetGetMessengerUnreadFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getOptionalWidgetAuth } = await import('../widget-auth')
  const { runGetMessengerUnread } = await import('../conversation')
  return runGetMessengerUnread(await getOptionalWidgetAuth())
})

export const widgetListConversationMessagesFn = createServerFn({ method: 'GET' })
  .validator(listMessagesSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runListConversationMessages } = await import('../conversation')
    return runListConversationMessages(await requireWidgetAuth(), data)
  })

export const widgetMarkConversationReadFn = createServerFn({ method: 'POST' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runMarkConversationRead } = await import('../conversation')
    return runMarkConversationRead(await requireWidgetAuth(), data)
  })

export const widgetSendConversationTypingFn = createServerFn({ method: 'POST' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runSendConversationTyping } = await import('../conversation')
    return runSendConversationTyping(await requireWidgetAuth(), data)
  })

export const widgetSubmitCsatFn = createServerFn({ method: 'POST' })
  .validator(csatSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runSubmitCsat } = await import('../conversation')
    return runSubmitCsat(await requireWidgetAuth(), data)
  })

export const widgetMintConversationStreamTokenFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runMintConversationStreamToken } = await import('../conversation')
    return runMintConversationStreamToken(await requireWidgetAuth())
  }
)
