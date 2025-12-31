'use server'

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { db, settings, member, user, postStatuses, eq, DEFAULT_STATUSES } from '@/lib/db'
import { getSettings } from '@/lib/server-functions/workspace'
import { generateId } from '@quackback/ids'
import type { UserId, StatusId } from '@quackback/ids'

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
 * Requires authentication and owner role.
 */
export const setupWorkspaceFn = createServerFn({ method: 'POST' })
  .inputValidator(setupWorkspaceSchema)
  .handler(async ({ data }: { data: SetupWorkspaceInput }): Promise<SetupWorkspaceResult> => {
    const ctx = await requireAuth({ roles: ['owner'] })
    const { workspaceName, userName } = data

    // Verify user is owner
    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, ctx.user.id as UserId),
    })

    if (!memberRecord || memberRecord.role !== 'owner') {
      throw new Error('Only owner can complete setup')
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
        .where(eq(user.id, ctx.user.id as UserId))
    }

    // Generate slug from workspace name
    const slug = workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    if (slug.length < 2) {
      throw new Error('Invalid workspace name - cannot generate valid slug')
    }

    // Use transaction to ensure atomicity - settings and statuses are created together
    const newSettings = await db.transaction(async (tx) => {
      // Create settings
      const [createdSettings] = await tx
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
      await tx.insert(postStatuses).values(statusValues)

      return createdSettings
    })

    return {
      id: newSettings.id,
      name: newSettings.name,
      slug: newSettings.slug,
    }
  })
