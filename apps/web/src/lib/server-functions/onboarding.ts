import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { UserId, StatusId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { getSession } from './auth'
import { getSettings } from './workspace'
import { db, settings, member, user, postStatuses, eq, DEFAULT_STATUSES } from '@/lib/db'

/**
 * Server functions for onboarding workflow.
 */

// ============================================
// Schemas
// ============================================

const setupWorkspaceSchema = z.object({
  workspaceName: z
    .string()
    .min(2, 'Workspace name must be at least 2 characters')
    .max(100, 'Workspace name must be 100 characters or less'),
  userName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be 100 characters or less')
    .optional(),
})

// ============================================
// Type Exports
// ============================================

export type SetupWorkspaceInput = z.infer<typeof setupWorkspaceSchema>

export interface SetupWorkspaceResult {
  id: string
  name: string
  slug: string
}

// ============================================
// Server Functions
// ============================================

/**
 * Setup workspace during onboarding.
 * Creates settings and default statuses in a transaction.
 * Requires authentication and admin role.
 *
 * NOTE: Cannot use requireAuth() here because it requires settings to exist,
 * but we're creating settings. We manually check auth and admin role instead.
 */
export const setupWorkspaceFn = createServerFn({ method: 'POST' })
  .inputValidator(setupWorkspaceSchema)
  .handler(async ({ data }: { data: SetupWorkspaceInput }): Promise<SetupWorkspaceResult> => {
    console.log(`[fn:onboarding] setupWorkspaceFn: workspaceName=${data.workspaceName}`)
    try {
      // Check authentication manually (can't use requireAuth - it needs settings to exist)
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      const { workspaceName, userName } = data

      // Verify user has admin member record
      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id as UserId),
      })

      if (!memberRecord || memberRecord.role !== 'admin') {
        throw new Error('Only admin can complete setup')
      }

      // Check if settings already exist
      const existingSettings = await getSettings()
      if (existingSettings) {
        throw new Error('Workspace already initialized')
      }

      // Update user's name if provided (for users created via emailOTP without a name)
      if (userName) {
        await db
          .update(user)
          .set({
            name: userName.trim(),
            updatedAt: new Date(),
          })
          .where(eq(user.id, session.user.id as UserId))
      }

      // Generate slug from workspace name
      const slug = workspaceName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

      if (slug.length < 2) {
        throw new Error('Invalid workspace name - cannot generate valid slug')
      }

      // Create settings
      // Note: Not using transaction because neon-http driver doesn't support interactive transactions.
      // These inserts are independent (postStatuses doesn't depend on settings result).
      const [createdSettings] = await db
        .insert(settings)
        .values({
          id: generateId('workspace'),
          name: workspaceName.trim(),
          slug,
          createdAt: new Date(),
          // Default portal config - all features enabled
          portalConfig: JSON.stringify({
            oauth: { google: true, github: true },
            features: { publicView: true, submissions: true, comments: true, voting: true },
          }),
          // Default auth config
          authConfig: JSON.stringify({
            oauth: { google: true, github: true, microsoft: false },
            openSignup: true,
          }),
        })
        .returning()

      // Create default post statuses
      const statusValues = DEFAULT_STATUSES.map((status) => ({
        id: generateId('status') as StatusId,
        ...status,
        createdAt: new Date(),
      }))
      await db.insert(postStatuses).values(statusValues)

      const newSettings = createdSettings

      console.log(
        `[fn:onboarding] setupWorkspaceFn: id=${newSettings.id}, slug=${newSettings.slug}`
      )
      return {
        id: newSettings.id,
        name: newSettings.name,
        slug: newSettings.slug,
      }
    } catch (error) {
      console.error(`[fn:onboarding] ❌ setupWorkspaceFn failed:`, error)
      throw error
    }
  })
