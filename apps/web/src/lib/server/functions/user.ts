import { z } from 'zod'
import type { Role } from '@/lib/shared/roles'
import { createServerFn } from '@tanstack/react-start'
import { type UserId, type PrincipalId } from '@quackback/ids'
import { getSession } from '@/lib/server/auth/session'
import { requireAuth } from './auth-helpers'
import { getCurrentUserRole } from './workspace'
import {
  db,
  user,
  principal,
  posts,
  votes,
  comments,
  eq,
  and,
  isNull,
  count,
} from '@/lib/server/db'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'
import { deleteObject } from '@/lib/server/storage/s3'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/server/domains/subscriptions/subscription.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'user' })

/**
 * User profile and notification preferences server functions.
 */

// ============================================
// Schemas
// ============================================

const updateProfileNameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
})

const saveAvatarKeySchema = z.object({
  key: z
    .string()
    .min(1)
    .startsWith('avatars/', 'Avatar key must start with "avatars/"')
    .refine((k) => !k.includes('..'), 'Avatar key must not contain path traversal'),
})

const updateNotificationPreferencesSchema = z.object({
  emailStatusChange: z.boolean().optional(),
  emailNewComment: z.boolean().optional(),
  emailMuted: z.boolean().optional(),
})

// ============================================
// Type Exports
// ============================================

export type UpdateProfileNameInput = z.infer<typeof updateProfileNameSchema>
export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>

export interface UserEngagementStats {
  ideas: number
  votes: number
  comments: number
}

export interface UserProfile {
  id: string
  name: string | null
  email: string | null
  image: string | null
  imageKey: string | null
  hasCustomAvatar: boolean
  userType?: 'team' | 'portal'
}

export interface NotificationPreferences {
  emailStatusChange: boolean
  emailNewComment: boolean
  emailMuted: boolean
}

// ============================================
// Helpers
// ============================================

/** Get the principalId for the current authenticated user. Throws if not found. */
async function requirePrincipalId(): Promise<PrincipalId> {
  const ctx = await requireAuth()
  return ctx.principal.id
}

/** Delete a user's existing S3 avatar if one exists. Silently ignores missing files. */
async function deleteExistingAvatar(userId: string): Promise<string | null> {
  const currentUser = await db.query.user.findFirst({
    where: eq(user.id, userId as UserId),
    columns: { imageKey: true },
  })

  if (currentUser?.imageKey) {
    try {
      await deleteObject(currentUser.imageKey)
    } catch {
      // Ignore deletion errors - old file may not exist
    }
  }

  return currentUser?.imageKey ?? null
}

// ============================================
// Server Functions
// ============================================

/**
 * Get current user's profile information.
 * Only requires authentication - any logged-in user can view their own profile.
 */
export const getProfileFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<UserProfile> => {
    log.debug('get profile')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      const userRecord = await db.query.user.findFirst({
        where: eq(user.id, session.user.id),
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
          imageKey: true,
        },
      })

      if (!userRecord) {
        throw new Error('User not found')
      }

      // Get principal record to determine userType
      const principalRecord = await db.query.principal.findFirst({
        where: eq(principal.userId, session.user.id as UserId),
        columns: { role: true },
      })

      const principalRole = principalRecord?.role
      let userType: 'team' | 'portal' | undefined
      if (principalRole === 'user') {
        userType = 'portal'
      } else if (principalRole) {
        userType = 'team'
      }

      log.debug({ user_id: userRecord.id, user_type: userType }, 'profile fetched')
      return {
        id: userRecord.id,
        name: userRecord.name,
        email: userRecord.email,
        image: userRecord.image,
        imageKey: userRecord.imageKey,
        hasCustomAvatar: !!userRecord.imageKey,
        userType,
      }
    } catch (error) {
      log.error({ err: error }, 'get profile failed')
      throw error
    }
  }
)

/**
 * Update current user's display name.
 * Only requires authentication - any logged-in user can update their own name.
 */
export const updateProfileNameFn = createServerFn({ method: 'POST' })
  .validator(updateProfileNameSchema)
  .handler(async ({ data }: { data: UpdateProfileNameInput }): Promise<UserProfile> => {
    log.debug('update profile name')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }
      const { name } = data

      const [updated] = await db
        .update(user)
        .set({ name: name.trim() })
        .where(eq(user.id, session.user.id))
        .returning()

      await syncPrincipalProfile(updated.id as UserId, { displayName: name.trim() })
      log.info({ user_id: updated.id }, 'profile name updated')
      return {
        ...updated,
        hasCustomAvatar: !!updated.imageKey,
      }
    } catch (error) {
      log.error({ err: error }, 'update profile name failed')
      throw error
    }
  })

/**
 * Remove custom avatar.
 * Only requires authentication - any logged-in user can remove their own avatar.
 */
export const removeAvatarFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<UserProfile> => {
    log.debug('remove avatar')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      await deleteExistingAvatar(session.user.id)

      const [updated] = await db
        .update(user)
        .set({ imageKey: null })
        .where(eq(user.id, session.user.id))
        .returning()

      await syncPrincipalProfile(updated.id as UserId, { avatarKey: null })
      log.info({ user_id: updated.id }, 'avatar removed')
      return {
        ...updated,
        hasCustomAvatar: false,
      }
    } catch (error) {
      log.error({ err: error }, 'remove avatar failed')
      throw error
    }
  }
)

/**
 * Save an S3 key as the user's avatar.
 * Called after the client uploads directly to S3 via a presigned URL.
 */
export const saveAvatarKeyFn = createServerFn({ method: 'POST' })
  .validator(saveAvatarKeySchema)
  .handler(async ({ data }: { data: z.infer<typeof saveAvatarKeySchema> }) => {
    log.debug('save avatar key')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      await deleteExistingAvatar(session.user.id)

      const [updated] = await db
        .update(user)
        .set({ imageKey: data.key })
        .where(eq(user.id, session.user.id))
        .returning()

      await syncPrincipalProfile(updated.id as UserId, { avatarKey: data.key })
      log.info({ user_id: updated.id }, 'avatar key saved')
    } catch (error) {
      log.error({ err: error }, 'save avatar key failed')
      throw error
    }
  })

/**
 * Get current user's role.
 * Only requires authentication - returns null if user has no member record.
 */
export const getUserRoleFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ role: Role | null }> => {
    log.debug('get user role')
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      const role = await getCurrentUserRole()
      log.debug({ role }, 'user role fetched')
      return { role }
    } catch (error) {
      log.error({ err: error }, 'get user role failed')
      throw error
    }
  }
)

/**
 * Get notification preferences.
 */
export const getNotificationPreferencesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NotificationPreferences> => {
    log.debug('get notification preferences')
    try {
      const principalId = await requirePrincipalId()
      const preferences = await getNotificationPreferences(principalId)
      log.debug('notification preferences fetched')
      return preferences
    } catch (error) {
      log.error({ err: error }, 'get notification preferences failed')
      throw error
    }
  }
)

/**
 * Update notification preferences.
 */
export const updateNotificationPreferencesFn = createServerFn({ method: 'POST' })
  .validator(updateNotificationPreferencesSchema)
  .handler(
    async ({
      data,
    }: {
      data: UpdateNotificationPreferencesInput
    }): Promise<NotificationPreferences> => {
      log.debug('update notification preferences')
      try {
        const principalId = await requirePrincipalId()
        const { emailStatusChange, emailNewComment, emailMuted } = data

        const updates: {
          emailStatusChange?: boolean
          emailNewComment?: boolean
          emailMuted?: boolean
        } = {}

        if (typeof emailStatusChange === 'boolean') {
          updates.emailStatusChange = emailStatusChange
        }
        if (typeof emailNewComment === 'boolean') {
          updates.emailNewComment = emailNewComment
        }
        if (typeof emailMuted === 'boolean') {
          updates.emailMuted = emailMuted
        }

        if (Object.keys(updates).length === 0) {
          throw new Error('No fields to update')
        }

        const preferences = await updateNotificationPreferences(principalId, updates)
        log.info('notification preferences updated')
        return preferences
      } catch (error) {
        log.error({ err: error }, 'update notification preferences failed')
        throw error
      }
    }
  )

// ============================================
// User Engagement Stats
// ============================================

export const getUserStatsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<UserEngagementStats> => {
    log.debug('get user stats')
    try {
      const principalId = await requirePrincipalId()

      const [ideasResult, votesResult, commentsResult] = await Promise.all([
        db
          .select({ count: count() })
          .from(posts)
          .where(and(eq(posts.principalId, principalId), isNull(posts.deletedAt))),
        db.select({ count: count() }).from(votes).where(eq(votes.principalId, principalId)),
        db
          .select({ count: count() })
          .from(comments)
          .where(and(eq(comments.principalId, principalId), isNull(comments.deletedAt))),
      ])

      return {
        ideas: ideasResult[0]?.count ?? 0,
        votes: votesResult[0]?.count ?? 0,
        comments: commentsResult[0]?.count ?? 0,
      }
    } catch (error) {
      log.error({ err: error }, 'get user stats failed')
      throw error
    }
  }
)
