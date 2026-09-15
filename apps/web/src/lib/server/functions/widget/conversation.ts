/**
 * Widget BFF for messenger. Portal keeps conversation.ts on cookie/site auth.
 */
import { createServerFn } from '@tanstack/react-start'
import {
  sendMessageSchema,
  myConversationSchema,
  listMessagesSchema,
  csatSchema,
  conversationIdSchema,
  runSendConversationMessage,
  runGetConversationPresence,
  runGetWidgetTeamAvatars,
  runGetMyConversation,
  runGetMyConversations,
  runGetMessengerUnread,
  runListConversationMessages,
  runMarkConversationRead,
  runSendConversationTyping,
  runSubmitCsat,
  runMintConversationStreamToken,
  type SendConversationMessageInput,
  type MyConversationInput,
} from '../conversation'
import { getOptionalWidgetAuth, requireWidgetAuth } from '../widget-auth'

export const widgetSendConversationMessageFn = createServerFn({ method: 'POST' })
  .validator(sendMessageSchema)
  .handler(async ({ data }: { data: SendConversationMessageInput }) => {
    return runSendConversationMessage(await requireWidgetAuth(), data)
  })

export const widgetGetConversationPresenceFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    return runGetConversationPresence()
  }
)

export const widgetGetTeamAvatarsFn = createServerFn({ method: 'GET' }).handler(async () => {
  return runGetWidgetTeamAvatars()
})

export const widgetGetMyConversationFn = createServerFn({ method: 'GET' })
  .validator(myConversationSchema)
  .handler(async ({ data }: { data: MyConversationInput }) => {
    return runGetMyConversation(await getOptionalWidgetAuth(), data)
  })

export const widgetGetMyConversationsFn = createServerFn({ method: 'GET' }).handler(async () => {
  return runGetMyConversations(await getOptionalWidgetAuth())
})

export const widgetGetMessengerUnreadFn = createServerFn({ method: 'GET' }).handler(async () => {
  return runGetMessengerUnread(await getOptionalWidgetAuth())
})

export const widgetListConversationMessagesFn = createServerFn({ method: 'GET' })
  .validator(listMessagesSchema)
  .handler(async ({ data }) => {
    return runListConversationMessages(await requireWidgetAuth(), data)
  })

export const widgetMarkConversationReadFn = createServerFn({ method: 'POST' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    return runMarkConversationRead(await requireWidgetAuth(), data)
  })

export const widgetSendConversationTypingFn = createServerFn({ method: 'POST' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    return runSendConversationTyping(await requireWidgetAuth(), data)
  })

export const widgetSubmitCsatFn = createServerFn({ method: 'POST' })
  .validator(csatSchema)
  .handler(async ({ data }) => {
    return runSubmitCsat(await requireWidgetAuth(), data)
  })

export const widgetMintConversationStreamTokenFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    return runMintConversationStreamToken(await requireWidgetAuth())
  }
)
