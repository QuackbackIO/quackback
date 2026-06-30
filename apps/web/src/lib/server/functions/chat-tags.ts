/**
 * Server functions for conversation tags ("labels"). Separate from the feedback
 * tag functions — these operate on the support-inbox chat_tags taxonomy. All
 * require a team member (admin/member); tags are agent-only.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChatTagId, ConversationId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  listChatTags,
  listChatTagsWithCounts,
  createChatTag,
  updateChatTag,
  deleteChatTag,
  attachTag,
  detachTag,
  listTagsForConversation,
} from '@/lib/server/domains/chat/chat-tag.service'

const createChatTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
})

const deleteChatTagSchema = z.object({ id: z.string() })

// Rename and/or recolor a label. At least one of name/color must be present.
const updateChatTagSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(50).optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  })
  .refine((d) => d.name !== undefined || d.color !== undefined, {
    message: 'Provide a name or color to update',
  })

// Add either an existing tag (`tagId`) or a brand-new one created on the fly
// (`name`, optionally `color`). Exactly the inline "+ Add / create" flow.
const addConversationTagSchema = z
  .object({
    conversationId: z.string(),
    tagId: z.string().optional(),
    name: z.string().min(1).max(50).optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  })
  .refine((d) => Boolean(d.tagId) || Boolean(d.name?.trim()), {
    message: 'Provide an existing tagId or a name to create',
  })

const removeConversationTagSchema = z.object({
  conversationId: z.string(),
  tagId: z.string(),
})

/** All conversation labels (for the picker). */
export const fetchChatTagsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
  return listChatTags()
})

/** Conversation labels with their conversation counts (drives the inbox nav). */
export const fetchChatTagsWithCountsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
  return listChatTagsWithCounts()
})

/** Create (or reuse, by name) a conversation label. */
export const createChatTagFn = createServerFn({ method: 'POST' })
  .validator(createChatTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    const tag = await createChatTag({ name: data.name, color: data.color })
    return { id: tag.id, name: tag.name, color: tag.color }
  })

/** Rename and/or recolor a conversation label. */
export const updateChatTagFn = createServerFn({ method: 'POST' })
  .validator(updateChatTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return updateChatTag(data.id as ChatTagId, { name: data.name, color: data.color })
  })

/** Soft-delete a conversation label. */
export const deleteChatTagFn = createServerFn({ method: 'POST' })
  .validator(deleteChatTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    await deleteChatTag(data.id as ChatTagId)
    return { id: data.id as ChatTagId }
  })

/**
 * Add a label to a conversation — by existing id, or by name (find-or-create,
 * the inline-create flow). Returns the conversation's updated tag list.
 */
export const addConversationTagFn = createServerFn({ method: 'POST' })
  .validator(addConversationTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    const conversationId = data.conversationId as ConversationId
    let tagId = data.tagId as ChatTagId | undefined
    if (data.name?.trim()) {
      const tag = await createChatTag({ name: data.name, color: data.color })
      tagId = tag.id
    }
    if (!tagId) return listTagsForConversation(conversationId)
    return attachTag(conversationId, tagId)
  })

/** Remove a label from a conversation. Returns the updated tag list. */
export const removeConversationTagFn = createServerFn({ method: 'POST' })
  .validator(removeConversationTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE })
    return detachTag(data.conversationId as ConversationId, data.tagId as ChatTagId)
  })
