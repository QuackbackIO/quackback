import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  MAX_CONVERSATION_MESSAGE_LENGTH,
  MAX_CONVERSATION_ATTACHMENTS,
} from '@/lib/shared/conversation/types'

const attachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().max(255),
  contentType: z.string().max(128),
  size: z.number().int().nonnegative(),
})

const blockReplySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('buttons'),
    inReplyToMessageId: z.string().min(1),
    buttonKey: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal('collect'),
    inReplyToMessageId: z.string().min(1),
    value: z.union([z.string().max(500), z.number(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('collectReply'),
    inReplyToMessageId: z.string().min(1),
    value: z.string().min(1).max(MAX_CONVERSATION_MESSAGE_LENGTH),
  }),
  z.object({
    kind: z.literal('csat'),
    inReplyToMessageId: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).optional(),
  }),
])

const sendMessageSchema = z.object({
  conversationId: z.string().optional(),
  content: z.string().max(MAX_CONVERSATION_MESSAGE_LENGTH).default(''),
  contentJson: z.unknown().nullable().optional(),
  attachments: z.array(attachmentSchema).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
  blockReply: blockReplySchema.optional(),
})

const myConversationSchema = z
  .object({ conversationId: z.string().nullish(), locale: z.string().max(20).optional() })
  .optional()

const listMessagesSchema = z.object({
  conversationId: z.string(),
  before: z.string().optional(),
})

const conversationIdSchema = z.object({ conversationId: z.string() })

const csatSchema = z.object({
  conversationId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
})

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
