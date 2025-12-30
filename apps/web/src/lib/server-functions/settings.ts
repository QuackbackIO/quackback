import { createServerFn } from '@tanstack/react-start'
import { db, member, user, invitation, eq, ne } from '@/lib/db'
import { getBulkUserAvatarData } from '@/lib/avatar'
import type { UserId } from '@quackback/ids'

/**
 * Server functions for settings data fetching.
 * These wrap database queries in createServerFn to keep database code server-only.
 */

/**
 * Fetch team members and invitations for team settings page
 */
export const fetchTeamMembersAndInvitations = createServerFn({ method: 'GET' }).handler(
  async () => {
    // Only show team members (owner, admin, member) - exclude portal users (role='user')
    const members = await db
      .select({
        id: member.id,
        role: member.role,
        userId: member.userId,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(ne(member.role, 'user'))

    // Fetch pending invitations
    const pendingInvitations = await db.query.invitation.findMany({
      where: eq(invitation.status, 'pending'),
      orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
    })

    // Get avatar URLs for all team members (base64 for SSR)
    const userIds = members.map((m) => m.userId)
    const avatarMap = await getBulkUserAvatarData(userIds)

    // Format invitations for client component (TypeIDs come directly from DB)
    const formattedInvitations = pendingInvitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      createdAt: inv.createdAt.toISOString(),
      lastSentAt: inv.lastSentAt?.toISOString() || null,
      expiresAt: inv.expiresAt.toISOString(),
    }))

    return {
      members,
      avatarMap: Object.fromEntries(avatarMap),
      formattedInvitations,
    }
  }
)

/**
 * Fetch user profile data including avatar
 */
export const fetchUserProfile = createServerFn({ method: 'GET' })
  .inputValidator((userId: UserId) => userId)
  .handler(async ({ data: userId }) => {
    // Fetch user's avatar data for SSR
    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: {
        imageBlob: true,
        imageType: true,
        image: true,
      },
    })

    const hasCustomAvatar = !!(userRecord?.imageBlob && userRecord?.imageType)
    // OAuth avatar URL (from GitHub, Google, etc.) - used as fallback
    const oauthAvatarUrl = userRecord?.image ?? null

    // Convert blob to base64 data URL for SSR - eliminates flicker
    // Custom blob avatar takes precedence over OAuth image URL
    let avatarUrl: string | null = null
    if (hasCustomAvatar && userRecord.imageBlob && userRecord.imageType) {
      const base64 = Buffer.from(userRecord.imageBlob).toString('base64')
      avatarUrl = `data:${userRecord.imageType};base64,${base64}`
    } else if (oauthAvatarUrl) {
      avatarUrl = oauthAvatarUrl
    }

    return {
      avatarUrl,
      oauthAvatarUrl,
      hasCustomAvatar,
    }
  })
