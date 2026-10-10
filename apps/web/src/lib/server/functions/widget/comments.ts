import { createServerFn } from '@tanstack/react-start'
import { createCommentSchema, reactionSchema } from '@/lib/shared/schemas/comments'

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
