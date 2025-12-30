import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, user, member, eq } from '@/lib/db'
import { getCurrentUserRole } from '@/lib/workspace'
import { getNotificationPreferences, updateNotificationPreferences } from '@/lib/subscriptions'
import { type MemberId, type UserId } from '@quackback/ids'
import { actionOk, actionErr, type ActionResult } from './types'

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
 */
export const getProfileAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<UserProfile>> => {
    try {
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
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
        return actionErr({ code: 'NOT_FOUND', message: 'User not found', status: 404 })
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

      return actionOk({
        id: userRecord.id,
        name: userRecord.name,
        email: userRecord.email,
        image: userRecord.image,
        imageType: userRecord.imageType,
        hasCustomAvatar: !!userRecord.imageType,
        userType,
      })
    } catch (error) {
      console.error('Error fetching user profile:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  }
)

/**
 * Update current user's display name.
 */
export const updateProfileNameAction = createServerFn({ method: 'POST' })
  .inputValidator(updateProfileNameSchema)
  .handler(async ({ data }): Promise<ActionResult<UserProfile>> => {
    try {
      const { name } = data

      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      const [updated] = await db
        .update(user)
        .set({ name: name.trim() })
        .where(eq(user.id, session.user.id))
        .returning({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          imageType: user.imageType,
        })

      return actionOk({
        ...updated,
        hasCustomAvatar: !!updated.imageType,
      })
    } catch (error) {
      console.error('Error updating user profile:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Remove custom avatar.
 */
export const removeAvatarAction = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ActionResult<UserProfile>> => {
    try {
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      const [updated] = await db
        .update(user)
        .set({
          imageBlob: null,
          imageType: null,
        })
        .where(eq(user.id, session.user.id))
        .returning({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          imageType: user.imageType,
        })

      return actionOk({
        ...updated,
        hasCustomAvatar: false,
      })
    } catch (error) {
      console.error('Error removing avatar:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  }
)

/**
 * Get current user's role.
 */
export const getUserRoleAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<{ role: 'owner' | 'admin' | 'member' | 'user' | null }>> => {
    try {
      const role = await getCurrentUserRole()
      return actionOk({ role })
    } catch (error) {
      console.error('Error fetching user role:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  }
)

/**
 * Get notification preferences.
 */
export const getNotificationPreferencesAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<NotificationPreferences>> => {
    try {
      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id as UserId),
      })

      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member',
          status: 403,
        })
      }

      const preferences = await getNotificationPreferences(memberRecord.id as MemberId)

      return actionOk(preferences)
    } catch (error) {
      console.error('Error fetching notification preferences:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  }
)

/**
 * Update notification preferences.
 */
export const updateNotificationPreferencesAction = createServerFn({ method: 'POST' })
  .inputValidator(updateNotificationPreferencesSchema)
  .handler(async ({ data }): Promise<ActionResult<NotificationPreferences>> => {
    try {
      const { emailStatusChange, emailNewComment, emailMuted } = data

      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          status: 401,
        })
      }

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id as UserId),
      })

      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member',
          status: 403,
        })
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
        return actionErr({
          code: 'VALIDATION_ERROR',
          message: 'No fields to update',
          status: 400,
        })
      }

      const preferences = await updateNotificationPreferences(memberRecord.id as MemberId, updates)

      return actionOk(preferences)
    } catch (error) {
      console.error('Error updating notification preferences:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })
