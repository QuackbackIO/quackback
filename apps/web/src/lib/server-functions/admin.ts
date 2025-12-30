import { createServerFn } from '@tanstack/react-start'
import { listInboxPosts } from '@/lib/posts'
import { listBoards } from '@/lib/boards'
import { listTags } from '@/lib/tags'
import { listStatuses } from '@/lib/statuses'
import { listTeamMembers } from '@/lib/members'
import { db, member, eq } from '@/lib/db'
import type { InboxPostListParams } from '@/lib/posts/post.types'
import type { BoardSettings } from '@quackback/db/types'
import type { TiptapContent } from '@/lib/schemas/posts'
import type { UserId } from '@quackback/ids'

/**
 * Server functions for admin data fetching.
 * These wrap service calls in createServerFn to keep database code server-only.
 */

/**
 * Fetch inbox posts with filters for admin feedback view
 */
export const fetchInboxPosts = createServerFn({ method: 'GET' })
  .inputValidator((params: InboxPostListParams) => params)
  .handler(async ({ data }) => {
    const result = await listInboxPosts(data)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize contentJson field
    return {
      ...result.value,
      items: result.value.items.map((p) => ({
        ...p,
        contentJson: (p.contentJson ?? {}) as TiptapContent,
      })),
    }
  })

/**
 * Fetch all boards for the organization
 */
export const fetchBoardsList = createServerFn({ method: 'GET' }).handler(async () => {
  const result = await listBoards()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  // Serialize settings field
  return result.value.map((b) => ({
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
  }))
})

/**
 * Fetch all tags for the organization
 */
export const fetchTagsList = createServerFn({ method: 'GET' }).handler(async () => {
  const result = await listTags()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Fetch all statuses for the organization
 */
export const fetchStatusesList = createServerFn({ method: 'GET' }).handler(async () => {
  const result = await listStatuses()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Fetch team members (not portal users)
 */
export const fetchTeamMembers = createServerFn({ method: 'GET' }).handler(async () => {
  const result = await listTeamMembers()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Check onboarding completion status
 */
export const fetchOnboardingStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const [orgBoards, members] = await Promise.all([
    db.query.boards.findMany({
      columns: { id: true },
    }),
    db.select({ id: member.id }).from(member),
  ])

  return {
    hasBoards: orgBoards.length > 0,
    memberCount: members.length,
  }
})

/**
 * Fetch boards list for settings page
 */
export const fetchBoardsForSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const orgBoards = await db.query.boards.findMany()
  return orgBoards.map((b) => ({
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
  }))
})

/**
 * Fetch integrations list
 */
export const fetchIntegrationsList = createServerFn({ method: 'GET' }).handler(async () => {
  const integrations = await db.query.integrations.findMany()
  return integrations
})

/**
 * Check onboarding state for a user
 * Returns member record, step, and whether boards exist
 */
export const checkOnboardingState = createServerFn({ method: 'GET' })
  .inputValidator((userId: string | undefined) => userId)
  .handler(async ({ data: userId }) => {
    if (!userId) {
      return {
        memberRecord: null,
        hasSettings: false,
        hasBoards: false,
      }
    }

    // Check if user has a member record
    let memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, userId),
    })

    if (!memberRecord) {
      // Check if any owner exists
      const existingOwner = await db.query.member.findFirst({
        where: eq(member.role, 'owner'),
      })

      if (existingOwner) {
        // Not first user - they need an invitation
        return {
          memberRecord: null,
          needsInvitation: true,
          hasSettings: false,
          hasBoards: false,
        }
      }

      // First user - create owner member record
      const { generateId } = await import('@quackback/ids')
      const [newMember] = await db
        .insert(member)
        .values({
          id: generateId('member'),
          userId: userId as UserId,
          role: 'owner',
          createdAt: new Date(),
        })
        .returning()

      memberRecord = newMember
    }

    // Check if boards exist
    const existingBoards = await db.query.boards.findFirst()

    return {
      memberRecord: memberRecord
        ? {
            id: memberRecord.id,
            userId: memberRecord.userId,
            role: memberRecord.role,
          }
        : null,
      needsInvitation: false,
      hasSettings: true,
      hasBoards: !!existingBoards,
    }
  })
