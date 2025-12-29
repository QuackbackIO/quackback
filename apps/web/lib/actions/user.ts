'use server'

import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, user, member, eq } from '@/lib/db'
import { getCurrentUserRole } from '@/lib/tenant'
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
// Actions
// ============================================

/**
 * Get current user's profile information.
 */
export async function getProfileAction(): Promise<ActionResult<UserProfile>> {
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

    // Determine userType based on member role
    // Portal users have role 'user', team members have 'owner', 'admin', or 'member'
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

/**
 * Update current user's display name.
 * Note: Avatar upload should still use the API route due to file handling.
 */
export async function updateProfileNameAction(
  rawInput: UpdateProfileNameInput
): Promise<ActionResult<UserProfile>> {
  try {
    const parseResult = updateProfileNameSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { name } = parseResult.data

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
}

/**
 * Remove custom avatar (set imageBlob and imageType to null).
 */
export async function removeAvatarAction(): Promise<ActionResult<UserProfile>> {
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

/**
 * Get current user's role in the workspace for the current domain.
 */
export async function getUserRoleAction(): Promise<
  ActionResult<{ role: 'owner' | 'admin' | 'member' | 'user' | null }>
> {
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

/**
 * Get notification preferences.
 */
export async function getNotificationPreferencesAction(): Promise<
  ActionResult<NotificationPreferences>
> {
  try {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      })
    }

    // Check membership
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

/**
 * Update notification preferences.
 */
export async function updateNotificationPreferencesAction(
  rawInput: UpdateNotificationPreferencesInput
): Promise<ActionResult<NotificationPreferences>> {
  try {
    const parseResult = updateNotificationPreferencesSchema.safeParse(rawInput)
    if (!parseResult.success) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
      })
    }

    const { emailStatusChange, emailNewComment, emailMuted } = parseResult.data

    const session = await getSession()
    if (!session?.user) {
      return actionErr({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      })
    }

    // Check membership
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

    // Build update object
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
}
