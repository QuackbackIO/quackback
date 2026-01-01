import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type UserId, type MemberId } from '@quackback/ids'

/**
 * User profile and notification preferences server functions.
 *
 * NOTE: All DB and server-only imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
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
    const { getSession } = await import('./auth')
    const { db, user, member, eq } = await import('@/lib/db')

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

    return {
      id: userRecord.id,
      name: userRecord.name,
      email: userRecord.email,
      image: userRecord.image,
      imageType: userRecord.imageType,
      hasCustomAvatar: !!userRecord.imageType,
      userType,
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
    const { getSession } = await import('./auth')
    const { db, user, eq } = await import('@/lib/db')

    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }
    const { name } = data

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

    return {
      ...updated,
      hasCustomAvatar: !!updated.imageType,
    }
  })

/**
 * Remove custom avatar.
 * Only requires authentication - any logged-in user can remove their own avatar.
 */
export const removeAvatarFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<UserProfile> => {
    const { getSession } = await import('./auth')
    const { db, user, eq } = await import('@/lib/db')

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
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        imageType: user.imageType,
      })

    return {
      ...updated,
      hasCustomAvatar: false,
    }
  }
)

/**
 * Get current user's role.
 * Only requires authentication - returns null if user has no member record.
 */
export const getUserRoleFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ role: 'owner' | 'admin' | 'member' | 'user' | null }> => {
    const { getSession } = await import('./auth')
    const { getCurrentUserRole } = await import('./workspace')

    const session = await getSession()
    if (!session?.user) {
      throw new Error('Authentication required')
    }

    const role = await getCurrentUserRole()
    return { role }
  }
)

/**
 * Get notification preferences.
 */
export const getNotificationPreferencesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NotificationPreferences> => {
    const { requireAuth } = await import('./auth-helpers')
    const { db, member, eq } = await import('@/lib/db')
    const { getNotificationPreferences } = await import('@/lib/subscriptions/subscription.service')

    const ctx = await requireAuth()

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, ctx.user.id as UserId),
    })

    if (!memberRecord) {
      throw new Error('You must be a member')
    }

    const preferences = await getNotificationPreferences(memberRecord.id as MemberId)
    return preferences
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
      const { requireAuth } = await import('./auth-helpers')
      const { db, member, eq } = await import('@/lib/db')
      const { updateNotificationPreferences } =
        await import('@/lib/subscriptions/subscription.service')

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

      const preferences = await updateNotificationPreferences(memberRecord.id as MemberId, updates)
      return preferences
    }
  )
