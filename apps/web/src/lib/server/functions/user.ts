import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type UserId, type PrincipalId } from '@quackback/ids'
import { getSession } from './auth'
import { requireAuth } from './auth-helpers'
import { getCurrentUserRole } from './workspace'
import { db, user, principal, eq } from '@/lib/server/db'
import { syncPrincipalProfile } from '@/lib/server/domains/principals/principal.service'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/server/domains/subscriptions/subscription.service'

/**
 * User profile and notification preferences server functions.
 */

// ============================================
// Schemas
// ============================================

const updateProfileNameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
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

export interface UserProfile {
  id: string
  name: string | null
  email: string
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

// ============================================
// Server Functions
// ============================================

/**
 * Get current user's profile information.
 * Only requires authentication - any logged-in user can view their own profile.
 */
export const getProfileFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<UserProfile> => {
    console.log(`[fn:user] getProfileFn`)
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

      console.log(`[fn:user] getProfileFn: id=${userRecord.id}, userType=${userType}`)
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
      console.error(`[fn:user] ❌ getProfileFn failed:`, error)
      throw error
    }
  }
)

/**
 * Update current user's display name.
 * Only requires authentication - any logged-in user can update their own name.
 */
export const updateProfileNameFn = createServerFn({ method: 'POST' })
  .inputValidator(updateProfileNameSchema)
  .handler(async ({ data }: { data: UpdateProfileNameInput }): Promise<UserProfile> => {
    console.log(`[fn:user] updateProfileNameFn`)
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
      console.log(`[fn:user] updateProfileNameFn: updated id=${updated.id}`)
      return {
        ...updated,
        hasCustomAvatar: !!updated.imageKey,
      }
    } catch (error) {
      console.error(`[fn:user] ❌ updateProfileNameFn failed:`, error)
      throw error
    }
  })

/**
 * Remove custom avatar.
 * Only requires authentication - any logged-in user can remove their own avatar.
 */
export const removeAvatarFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<UserProfile> => {
    console.log(`[fn:user] removeAvatarFn`)
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      // Get current user to check for existing S3 key
      const currentUser = await db.query.user.findFirst({
        where: eq(user.id, session.user.id),
        columns: { imageKey: true },
      })

      // Delete old S3 image if exists
      if (currentUser?.imageKey) {
        try {
          const { deleteObject } = await import('@/lib/server/storage/s3')
          await deleteObject(currentUser.imageKey)
        } catch {
          // Ignore deletion errors - old file may not exist
        }
      }

      const [updated] = await db
        .update(user)
        .set({
          imageKey: null,
        })
        .where(eq(user.id, session.user.id))
        .returning()

      await syncPrincipalProfile(updated.id as UserId, { avatarKey: null })
      console.log(`[fn:user] removeAvatarFn: removed for id=${updated.id}`)
      return {
        ...updated,
        hasCustomAvatar: false,
      }
    } catch (error) {
      console.error(`[fn:user] ❌ removeAvatarFn failed:`, error)
      throw error
    }
  }
)

/**
 * Get current user's role.
 * Only requires authentication - returns null if user has no member record.
 */
export const getUserRoleFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ role: 'admin' | 'member' | 'user' | null }> => {
    console.log(`[fn:user] getUserRoleFn`)
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      const role = await getCurrentUserRole()
      console.log(`[fn:user] getUserRoleFn: role=${role}`)
      return { role }
    } catch (error) {
      console.error(`[fn:user] ❌ getUserRoleFn failed:`, error)
      throw error
    }
  }
)

/**
 * Get notification preferences.
 */
export const getNotificationPreferencesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NotificationPreferences> => {
    console.log(`[fn:user] getNotificationPreferencesFn`)
    try {
      const principalId = await requirePrincipalId()
      const preferences = await getNotificationPreferences(principalId)
      console.log(`[fn:user] getNotificationPreferencesFn: fetched`)
      return preferences
    } catch (error) {
      console.error(`[fn:user] ❌ getNotificationPreferencesFn failed:`, error)
      throw error
    }
  }
)

/**
 * Update notification preferences.
 */
export const updateNotificationPreferencesFn = createServerFn({ method: 'POST' })
  .inputValidator(updateNotificationPreferencesSchema)
  .handler(
    async ({
      data,
    }: {
      data: UpdateNotificationPreferencesInput
    }): Promise<NotificationPreferences> => {
      console.log(`[fn:user] updateNotificationPreferencesFn`)
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
        console.log(`[fn:user] updateNotificationPreferencesFn: updated`)
        return preferences
      } catch (error) {
        console.error(`[fn:user] ❌ updateNotificationPreferencesFn failed:`, error)
        throw error
      }
    }
  )
