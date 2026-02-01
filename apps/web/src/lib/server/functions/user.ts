import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type UserId, type MemberId } from '@quackback/ids'
import { getSession } from './auth'
import { requireAuth } from './auth-helpers'
import { getCurrentUserRole } from './workspace'
import { db, user, member, eq } from '@/lib/db'
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
  imageType: string | null
  hasCustomAvatar: boolean
  userType?: 'team' | 'portal'
}

export interface NotificationPreferences {
  emailStatusChange: boolean
  emailNewComment: boolean
  emailMuted: boolean
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
          imageType: true,
        },
      })

      if (!userRecord) {
        throw new Error('User not found')
      }

      // Get member record to determine userType
      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id as UserId),
        columns: { role: true },
      })

      const memberRole = memberRecord?.role
      const userType: 'team' | 'portal' | undefined = memberRole
        ? memberRole === 'user'
          ? 'portal'
          : 'team'
        : undefined

      console.log(`[fn:user] getProfileFn: id=${userRecord.id}, userType=${userType}`)
      return {
        id: userRecord.id,
        name: userRecord.name,
        email: userRecord.email,
        image: userRecord.image,
        imageType: userRecord.imageType,
        hasCustomAvatar: !!userRecord.imageType,
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

      console.log(`[fn:user] updateProfileNameFn: updated id=${updated.id}`)
      return {
        ...updated,
        hasCustomAvatar: !!updated.imageType,
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

      const [updated] = await db
        .update(user)
        .set({
          imageBlob: null,
          imageType: null,
        })
        .where(eq(user.id, session.user.id))
        .returning()

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
      const ctx = await requireAuth()

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, ctx.user.id as UserId),
      })

      if (!memberRecord) {
        throw new Error('You must be a member')
      }

      const preferences = await getNotificationPreferences(memberRecord.id as MemberId)
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
        const ctx = await requireAuth()
        const { emailStatusChange, emailNewComment, emailMuted } = data

        const memberRecord = await db.query.member.findFirst({
          where: eq(member.userId, ctx.user.id as UserId),
        })

        if (!memberRecord) {
          throw new Error('You must be a member')
        }

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

        const preferences = await updateNotificationPreferences(
          memberRecord.id as MemberId,
          updates
        )
        console.log(`[fn:user] updateNotificationPreferencesFn: updated`)
        return preferences
      } catch (error) {
        console.error(`[fn:user] ❌ updateNotificationPreferencesFn failed:`, error)
        throw error
      }
    }
  )
