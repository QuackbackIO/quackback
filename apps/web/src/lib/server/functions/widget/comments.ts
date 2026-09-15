import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'

const createCommentSchema = z.object({
  postId: z.string(),
  content: z.string().min(1).max(5000),
  contentJson: z.unknown().nullable().optional(),
  parentId: z.string().optional(),
  statusId: z.string().optional(),
  isPrivate: z.boolean().optional(),
})

const reactionSchema = z.object({
  commentId: z.string(),
  emoji: z.string(),
})

export const widgetCreateCommentFn = createServerFn({ method: 'POST' })
  .validator(createCommentSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runCreateComment } = await import('../comments')
    return runCreateComment(await requireWidgetAuth(), data)
  })

export const widgetAddReactionFn = createServerFn({ method: 'POST' })
  .validator(reactionSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runAddReaction } = await import('../comments')
    return runAddReaction(await requireWidgetAuth(), data)
  })

export const widgetRemoveReactionFn = createServerFn({ method: 'POST' })
  .validator(reactionSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runRemoveReaction } = await import('../comments')
    return runRemoveReaction(await requireWidgetAuth(), data)
  })
