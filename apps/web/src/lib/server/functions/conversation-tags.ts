/**
 * Server functions for conversation tags ("labels"). Separate from the feedback
 * tag functions — these operate on the support-inbox chat_tags taxonomy.
 * Applying/removing a label needs conversation.set_tags; defining the taxonomy
 * (create/update/delete, and inline-create) needs conversation.manage_tags.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ConversationTagId, ConversationId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { ForbiddenError } from '@/lib/shared/errors'
import {
  listConversationTags,
  listConversationTagsWithCounts,
  createConversationTag,
  updateConversationTag,
  deleteConversationTag,
  attachTag,
  detachTag,
  listTagsForConversation,
} from '@/lib/server/domains/conversation/conversation-tag.service'

const createConversationTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
})

const deleteConversationTagSchema = z.object({ id: z.string() })

// Rename and/or recolor a label. At least one of name/color must be present.
const updateConversationTagSchema = z
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
export const fetchConversationTagsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
  return listConversationTags()
})

/** Conversation labels with their conversation counts (drives the inbox nav). */
export const fetchConversationTagsWithCountsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    return listConversationTagsWithCounts()
  }
)

/** Create (or reuse, by name) a conversation label. */
export const createConversationTagFn = createServerFn({ method: 'POST' })
  .validator(createConversationTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE_TAGS })
    const tag = await createConversationTag({ name: data.name, color: data.color })
    return { id: tag.id, name: tag.name, color: tag.color }
  })

/** Rename and/or recolor a conversation label. */
export const updateConversationTagFn = createServerFn({ method: 'POST' })
  .validator(updateConversationTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE_TAGS })
    return updateConversationTag(data.id as ConversationTagId, {
      name: data.name,
      color: data.color,
    })
  })

/** Soft-delete a conversation label. */
export const deleteConversationTagFn = createServerFn({ method: 'POST' })
  .validator(deleteConversationTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE_TAGS })
    await deleteConversationTag(data.id as ConversationTagId)
    return { id: data.id as ConversationTagId }
  })

/**
 * Add a label to a conversation — by existing id, or by name (find-or-create,
 * the inline-create flow). Returns the conversation's updated tag list.
 */
export const addConversationTagFn = createServerFn({ method: 'POST' })
  .validator(addConversationTagSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_SET_TAGS })
    const conversationId = data.conversationId as ConversationId
    let tagId = data.tagId as ConversationTagId | undefined
    if (data.name?.trim()) {
      // Inline-create mints new taxonomy, so it additionally requires manage_tags.
      if (!resolveActorPermissions(auth.principal.role).has(PERMISSIONS.CONVERSATION_MANAGE_TAGS)) {
        throw new ForbiddenError(
          'FORBIDDEN',
          `Requires the '${PERMISSIONS.CONVERSATION_MANAGE_TAGS}' permission`
        )
      }
      const tag = await createConversationTag({ name: data.name, color: data.color })
      tagId = tag.id
    }
    if (!tagId) return listTagsForConversation(conversationId)
    return attachTag(conversationId, tagId)
  })

/** Remove a label from a conversation. Returns the updated tag list. */
export const removeConversationTagFn = createServerFn({ method: 'POST' })
  .validator(removeConversationTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.CONVERSATION_SET_TAGS })
    return detachTag(data.conversationId as ConversationId, data.tagId as ConversationTagId)
  })
