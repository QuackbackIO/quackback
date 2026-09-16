import { z } from 'zod'
import {
  MAX_CONVERSATION_ATTACHMENTS,
  MAX_CONVERSATION_MESSAGE_LENGTH,
} from '@/lib/shared/conversation/types'

export const conversationAttachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().max(255),
  contentType: z.string().max(128),
  size: z.number().int().nonnegative(),
})

/** Shape only — canonical block-reply validation lives in the conversation service. */
export const blockReplySchema = z.discriminatedUnion('kind', [
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

/** Empty content is allowed here; the service rejects empty-and-no-attachments. */
export const sendMessageSchema = z.object({
  conversationId: z.string().optional(),
  content: z.string().max(MAX_CONVERSATION_MESSAGE_LENGTH).default(''),
  contentJson: z.unknown().nullable().optional(),
  attachments: z.array(conversationAttachmentSchema).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
  blockReply: blockReplySchema.optional(),
})
export type SendConversationMessageInput = z.infer<typeof sendMessageSchema>

export const conversationIdSchema = z.object({ conversationId: z.string() })
export type ConversationIdInput = z.infer<typeof conversationIdSchema>

export const listMessagesSchema = z.object({
  conversationId: z.string(),
  before: z.string().optional(),
})
export type ListMessagesInput = z.infer<typeof listMessagesSchema>

export const myConversationSchema = z
  .object({ conversationId: z.string().nullish(), locale: z.string().max(20).optional() })
  .optional()
export type MyConversationInput = z.infer<typeof myConversationSchema>

export const csatSchema = z.object({
  conversationId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
})
export type CsatInput = z.infer<typeof csatSchema>
