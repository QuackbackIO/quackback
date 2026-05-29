/**
 * Server functions for comment operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { type CommentId, type PostId, type StatusId, type UserId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { createActivity } from '@/lib/server/domains/activity/activity.service'

import { createComment } from '@/lib/server/domains/comments/comment.service'
import { policyActorFromAuth } from './auth-helpers'
import { addReaction, removeReaction } from '@/lib/server/domains/comments/comment.reactions'
import {
  canDeleteComment,
  canEditComment,
  softDeleteComment,
  userEditComment,
} from '@/lib/server/domains/comments/comment.permissions'
import {
  canPinComment,
  pinComment,
  restoreComment,
  unpinComment,
} from '@/lib/server/domains/comments/comment.pin'
import { NotFoundError } from '@/lib/shared/errors'
import { getOptionalAuth, requireAuth, hasAuthCredentials } from './auth-helpers'

// Schemas
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

const getCommentPermissionsSchema = z.object({
  commentId: z.string(),
})

const userEditCommentSchema = z.object({
  commentId: z.string(),
  content: z.string(),
  contentJson: z.unknown().nullable().optional(),
})

const userDeleteCommentSchema = z.object({
  commentId: z.string(),
})

// Types
export type CreateCommentInput = z.infer<typeof createCommentSchema>
export interface UpdateCommentInput {
  id: string
  content: string
}
export interface DeleteCommentInput {
  id: string
}
export type ReactionInput = z.infer<typeof reactionSchema>
export type GetCommentPermissionsInput = z.infer<typeof getCommentPermissionsSchema>
export type UserEditCommentInput = z.infer<typeof userEditCommentSchema>
export type UserDeleteCommentInput = z.infer<typeof userDeleteCommentSchema>

// Write Operations
export const createCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(createCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] createCommentFn: postId=${data.postId}`)
    try {
      // Portal-visibility gate: a denied caller (signed-in but not on
      // the allowlist of a private portal) must not be able to comment.
      // Matches createPublicPostFn / toggleVoteFn — read-side gating
      // already runs at list / detail, the write surface needs it too
      // or the caller could mutate from inside a portal they're not
      // entitled to view. Dynamic import keeps the cycle out of static
      // analysis (comments.ts ↔ portal-access.ts both pull from db).
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      // Block anonymous users unless the workspace master switch allows
      // anonymous interaction. Per-board comment tiers are still checked
      // downstream; this is the workspace-wide ceiling collapsed in
      // migration 0084 from the legacy anonymousCommenting flag.
      if (auth.principal.type === 'anonymous') {
        // Fail closed on a missing flag — read the raw config, not
        // getPortalConfig's permissive merged default (matches the vote/post
        // gates). The per-board comment tier is enforced downstream.
        const { getSettings } = await import('./workspace')
        const { workspaceAllowsAnonymous } =
          await import('@/lib/server/domains/settings/settings.types')
        const settings = await getSettings()
        if (!workspaceAllowsAnonymous(settings?.portalConfig)) {
          throw new Error('Anonymous interaction is not enabled')
        }
      }

      const actor = await policyActorFromAuth(auth)

      const result = await createComment(
        {
          postId: data.postId as PostId,
          content: data.content,
          contentJson: (data.contentJson ?? undefined) as
            | import('@/lib/shared/db-types').TiptapContent
            | undefined,
          parentId: data.parentId as CommentId | undefined,
          statusId: data.statusId as StatusId | undefined,
          isPrivate: data.isPrivate,
        },
        {
          principalId: auth.principal.id,
          userId: auth.user.id as UserId,
          name: auth.user.name,
          email: auth.user.email,
          role: auth.principal.role,
        },
        actor,
        { headers: getRequestHeaders() }
      )

      // Events are dispatched by the service layer

      console.log(`[fn:comments] createCommentFn: id=${result.comment.id}`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ createCommentFn failed:`, error)
      throw error
    }
  })

export const addReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(reactionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] addReactionFn: commentId=${data.commentId}, emoji=${data.emoji}`)
    try {
      // Portal-visibility gate — mirror createCommentFn / toggleVoteFn.
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      // The reaction service now runs canViewPost + isPrivate using
      // the actor; without that, an authenticated user could probe
      // commentIds on team-only / private comments.
      const actor = await policyActorFromAuth(auth)
      const result = await addReaction(
        data.commentId as CommentId,
        data.emoji,
        auth.principal.id,
        actor
      )
      console.log(`[fn:comments] addReactionFn: added=${result.added}`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ addReactionFn failed:`, error)
      throw error
    }
  })

export const removeReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(reactionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] removeReactionFn: commentId=${data.commentId}, emoji=${data.emoji}`)
    try {
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      const actor = await policyActorFromAuth(auth)
      const result = await removeReaction(
        data.commentId as CommentId,
        data.emoji,
        auth.principal.id,
        actor
      )
      console.log(`[fn:comments] removeReactionFn: removed`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ removeReactionFn failed:`, error)
      throw error
    }
  })

// Read Operations
export const getCommentPermissionsFn = createServerFn({ method: 'GET' })
  .inputValidator(getCommentPermissionsSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] getCommentPermissionsFn: commentId=${data.commentId}`)
    try {
      // Early bailout: no session cookie = no permissions (skip DB queries)
      if (!hasAuthCredentials()) {
        console.log(`[fn:comments] getCommentPermissionsFn: no session cookie, skipping auth`)
        return { canEdit: false, canDelete: false }
      }

      const ctx = await getOptionalAuth()
      if (!ctx?.principal) {
        console.log(`[fn:comments] getCommentPermissionsFn: no auth context`)
        return { canEdit: false, canDelete: false }
      }

      const actor = { principalId: ctx.principal.id, role: ctx.principal.role }
      const [editResult, deleteResult] = await Promise.all([
        canEditComment(data.commentId as CommentId, actor),
        canDeleteComment(data.commentId as CommentId, actor),
      ])

      console.log(
        `[fn:comments] getCommentPermissionsFn: canEdit=${editResult.allowed}, canDelete=${deleteResult.allowed}`
      )
      return {
        canEdit: editResult.allowed,
        canDelete: deleteResult.allowed,
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        console.log(`[fn:comments] getCommentPermissionsFn: comment not found`)
        return { canEdit: false, canDelete: false }
      }
      console.error(`[fn:comments] getCommentPermissionsFn failed:`, error)
      throw error
    }
  })

export const userEditCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] userEditCommentFn: commentId=${data.commentId}`)
    try {
      // Portal-visibility gate + per-comment audience gate. Same shape
      // as the userEditPostFn / userDeletePostFn fixes: the existing
      // canEditComment policy only checks authorship + lock state, so
      // an authenticated portal user could mutate a comment on a
      // team-only or segment-restricted board they had no business
      // seeing (or commenting on after the audience change).
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const ctx = await requireAuth()
      const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
      const policyActor = await policyActorFromAuth(ctx)
      await assertCommentViewable(data.commentId as CommentId, policyActor)

      const actor = { principalId: ctx.principal.id, role: ctx.principal.role }

      const result = await userEditComment(data.commentId as CommentId, data.content, actor, {
        contentJson: (data.contentJson ?? undefined) as
          | import('@/lib/shared/db-types').TiptapContent
          | undefined,
      })
      console.log(`[fn:comments] userEditCommentFn: edited id=${data.commentId}`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ userEditCommentFn failed:`, error)
      throw error
    }
  })

export const userDeleteCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userDeleteCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] userDeleteCommentFn: commentId=${data.commentId}`)
    try {
      const { resolvePortalAccessForRequest } = await import('./portal-access')
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        throw new Error('Portal access required')
      }
      const ctx = await requireAuth()
      const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
      const policyActor = await policyActorFromAuth(ctx)
      await assertCommentViewable(data.commentId as CommentId, policyActor)

      const actor = { principalId: ctx.principal.id, role: ctx.principal.role }

      await softDeleteComment(data.commentId as CommentId, actor)
      console.log(`[fn:comments] userDeleteCommentFn: deleted id=${data.commentId}`)
      return { id: data.commentId }
    } catch (error) {
      console.error(`[fn:comments] ❌ userDeleteCommentFn failed:`, error)
      throw error
    }
  })

// Restore Operations
const restoreCommentSchema = z.object({
  commentId: z.string(),
})

export type RestoreCommentInput = z.infer<typeof restoreCommentSchema>

export const restoreCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(restoreCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] restoreCommentFn: commentId=${data.commentId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      await restoreComment(data.commentId as CommentId, {
        principalId: auth.principal.id,
        role: auth.principal.role,
      })
      console.log(`[fn:comments] restoreCommentFn: restored id=${data.commentId}`)
      return { id: data.commentId }
    } catch (error) {
      console.error(`[fn:comments] ❌ restoreCommentFn failed:`, error)
      throw error
    }
  })

// Pin/Unpin Operations
const pinCommentSchema = z.object({
  commentId: z.string(),
})

const unpinCommentSchema = z.object({
  postId: z.string(),
})

const canPinCommentSchema = z.object({
  commentId: z.string(),
})

export type PinCommentInput = z.infer<typeof pinCommentSchema>
export type UnpinCommentInput = z.infer<typeof unpinCommentSchema>
export type CanPinCommentInput = z.infer<typeof canPinCommentSchema>

export const pinCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(pinCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] pinCommentFn: commentId=${data.commentId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const result = await pinComment(data.commentId as CommentId, {
        principalId: auth.principal.id,
        role: auth.principal.role,
      })

      createActivity({
        postId: result.postId,
        principalId: auth.principal.id,
        type: 'comment.pinned',
        metadata: { commentId: data.commentId },
      })

      console.log(
        `[fn:comments] pinCommentFn: pinned comment ${data.commentId} on post ${result.postId}`
      )
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ pinCommentFn failed:`, error)
      throw error
    }
  })

export const unpinCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(unpinCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] unpinCommentFn: postId=${data.postId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      await unpinComment(data.postId as PostId, {
        principalId: auth.principal.id,
        role: auth.principal.role,
      })

      createActivity({
        postId: data.postId as PostId,
        principalId: auth.principal.id,
        type: 'comment.unpinned',
      })

      console.log(`[fn:comments] unpinCommentFn: unpinned comment from post ${data.postId}`)
      return { postId: data.postId }
    } catch (error) {
      console.error(`[fn:comments] ❌ unpinCommentFn failed:`, error)
      throw error
    }
  })

export const canPinCommentFn = createServerFn({ method: 'GET' })
  .inputValidator(canPinCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] canPinCommentFn: commentId=${data.commentId}`)
    try {
      // Early bailout: no session cookie = can't pin (skip DB queries)
      if (!hasAuthCredentials()) {
        console.log(`[fn:comments] canPinCommentFn: no session cookie, skipping auth`)
        return { canPin: false, reason: 'Only team members can pin comments' }
      }

      const ctx = await getOptionalAuth()
      // Must be a team member to pin
      if (!ctx?.principal || !isTeamMember(ctx.principal.role)) {
        return { canPin: false, reason: 'Only team members can pin comments' }
      }

      const result = await canPinComment(data.commentId as CommentId)
      console.log(`[fn:comments] canPinCommentFn: canPin=${result.canPin}`)
      return result
    } catch (error) {
      if (error instanceof NotFoundError) {
        console.log(`[fn:comments] canPinCommentFn: comment not found`)
        return { canPin: false, reason: 'Comment not found' }
      }
      console.error(`[fn:comments] canPinCommentFn failed:`, error)
      throw error
    }
  })
