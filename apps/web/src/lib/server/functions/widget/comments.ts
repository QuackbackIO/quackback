import { createServerFn } from '@tanstack/react-start'
import {
  createCommentSchema,
  reactionSchema,
  runCreateComment,
  runAddReaction,
  runRemoveReaction,
  type CreateCommentInput,
  type ReactionInput,
} from '../comments'
import { requireWidgetAuth } from '../widget-auth'

export const widgetCreateCommentFn = createServerFn({ method: 'POST' })
  .validator(createCommentSchema)
  .handler(async ({ data }: { data: CreateCommentInput }) => {
    return runCreateComment(await requireWidgetAuth(), data)
  })

export const widgetAddReactionFn = createServerFn({ method: 'POST' })
  .validator(reactionSchema)
  .handler(async ({ data }: { data: ReactionInput }) => {
    return runAddReaction(await requireWidgetAuth(), data)
  })

export const widgetRemoveReactionFn = createServerFn({ method: 'POST' })
  .validator(reactionSchema)
  .handler(async ({ data }: { data: ReactionInput }) => {
    return runRemoveReaction(await requireWidgetAuth(), data)
  })
