import { db, user as userTable, member as memberTable, eq, inArray } from '@quackback/db'

interface AvatarData {
  avatarUrl: string | null
  hasCustomAvatar: boolean
}

/**
 * Get avatar URL for a user, converting blob to base64 data URL for SSR.
 * This eliminates flicker by embedding image data directly in HTML.
 *
 * @param userId - The user's ID
 * @param fallbackImageUrl - Optional OAuth image URL to use if no custom avatar
 * @returns Avatar data with base64 URL or fallback URL
 */
export async function getUserAvatarData(
  userId: string,
  fallbackImageUrl?: string | null
): Promise<AvatarData> {
  const userRecord = await db.query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: {
      imageBlob: true,
      imageType: true,
      image: true,
    },
  })

  if (!userRecord) {
    return { avatarUrl: fallbackImageUrl ?? null, hasCustomAvatar: false }
  }

  // Custom blob avatar takes precedence
  if (userRecord.imageBlob && userRecord.imageType) {
    const base64 = Buffer.from(userRecord.imageBlob).toString('base64')
    return {
      avatarUrl: `data:${userRecord.imageType};base64,${base64}`,
      hasCustomAvatar: true,
    }
  }

  // Fall back to OAuth image URL
  return {
    avatarUrl: userRecord.image ?? fallbackImageUrl ?? null,
    hasCustomAvatar: false,
  }
}

/**
 * Get avatar URLs for multiple users in a single query.
 * More efficient than calling getUserAvatarData multiple times.
 *
 * @param userIds - Array of user IDs
 * @returns Map of userId to avatar URL
 */
export async function getBulkUserAvatarData(
  userIds: string[]
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) {
    return new Map()
  }

  const users = await db.query.user.findMany({
    where: (users, { inArray }) => inArray(users.id, userIds),
    columns: {
      id: true,
      imageBlob: true,
      imageType: true,
      image: true,
    },
  })

  const avatarMap = new Map<string, string | null>()

  for (const user of users) {
    if (user.imageBlob && user.imageType) {
      const base64 = Buffer.from(user.imageBlob).toString('base64')
      avatarMap.set(user.id, `data:${user.imageType};base64,${base64}`)
    } else {
      avatarMap.set(user.id, user.image)
    }
  }

  // Fill in null for any users not found
  for (const userId of userIds) {
    if (!avatarMap.has(userId)) {
      avatarMap.set(userId, null)
    }
  }

  return avatarMap
}

/**
 * Get avatar URLs for multiple members in a single query.
 * Maps member IDs to avatar URLs by looking up member → user → avatar.
 *
 * @param memberIds - Array of member IDs (null values are filtered out)
 * @returns Map of memberId to avatar URL (base64 data URL or external URL)
 */
export async function getBulkMemberAvatarData(
  memberIds: (string | null)[]
): Promise<Map<string, string | null>> {
  // Filter out nulls
  const validMemberIds = memberIds.filter((id): id is string => id !== null)

  if (validMemberIds.length === 0) {
    return new Map()
  }

  // Get members with their user data
  const members = await db
    .select({
      memberId: memberTable.id,
      userId: memberTable.userId,
      imageBlob: userTable.imageBlob,
      imageType: userTable.imageType,
      image: userTable.image,
    })
    .from(memberTable)
    .innerJoin(userTable, eq(memberTable.userId, userTable.id))
    .where(inArray(memberTable.id, validMemberIds))

  const avatarMap = new Map<string, string | null>()

  for (const member of members) {
    if (member.imageBlob && member.imageType) {
      const base64 = Buffer.from(member.imageBlob).toString('base64')
      avatarMap.set(member.memberId, `data:${member.imageType};base64,${base64}`)
    } else {
      avatarMap.set(member.memberId, member.image)
    }
  }

  // Fill in null for any members not found
  for (const memberId of validMemberIds) {
    if (!avatarMap.has(memberId)) {
      avatarMap.set(memberId, null)
    }
  }

  return avatarMap
}
