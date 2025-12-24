'use server'

import { z } from 'zod'
import { db, settings, member, user, postStatuses, eq, DEFAULT_STATUSES } from '@/lib/db'
import { getSettings } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { generateId } from '@quackback/ids'
import type { UserId, StatusId } from '@quackback/ids'
import { actionOk, actionErr, type ActionResult } from './types'

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
// Actions
// ============================================

/**
 * Setup workspace during onboarding.
 * Creates settings and default statuses in a transaction.
 * Requires authentication and owner role.
 */
export async function setupWorkspaceAction(
  input: SetupWorkspaceInput
): Promise<ActionResult<SetupWorkspaceResult>> {
  try {
    // 1. Validate input
    const parseResult = setupWorkspaceSchema.safeParse(input)
    if (!parseResult.success) {
      const fieldErrors: Record<string, string[]> = {}
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join('.')
        if (!fieldErrors[path]) fieldErrors[path] = []
        fieldErrors[path].push(issue.message)
      }
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
        status: 400,
        fieldErrors,
      })
    }

    const { workspaceName, userName } = parseResult.data

    // 2. Require authentication
    const session = await getSession()
    if (!session?.user) {
      return actionErr({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        status: 401,
      })
    }

    // 3. Verify user is owner (created by onboarding page on first sign-in)
    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })

    if (!memberRecord || memberRecord.role !== 'owner') {
      return actionErr({
        code: 'FORBIDDEN',
        message: 'Only owner can complete setup',
        status: 403,
      })
    }

    // 4. Check if settings already exist
    const existingSettings = await getSettings()
    if (existingSettings) {
      return actionErr({
        code: 'CONFLICT',
        message: 'Workspace already initialized',
        status: 409,
      })
    }

    // 5. Update user's name if provided (for users created via emailOTP without a name)
    if (userName) {
      await db
        .update(user)
        .set({
          name: userName.trim(),
          updatedAt: new Date(),
        })
        .where(eq(user.id, session.user.id as UserId))
    }

    // 6. Generate slug from workspace name
    const slug = workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    if (slug.length < 2) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: 'Invalid workspace name - cannot generate valid slug',
        status: 400,
      })
    }

    // 7. Use transaction to ensure atomicity - settings and statuses are created together
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

    return actionOk({
      id: newSettings.id,
      name: newSettings.name,
      slug: newSettings.slug,
    })
  } catch (error) {
    console.error('Error in setupWorkspaceAction:', error)
    return actionErr({
      code: 'INTERNAL_ERROR',
      message: 'Failed to create workspace',
      status: 500,
    })
  }
}
