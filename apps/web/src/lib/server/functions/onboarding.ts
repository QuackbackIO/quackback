import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { UserId, StatusId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { USE_CASE_TYPES } from '@quackback/db/types'
import type { SetupState, UseCaseType } from '@quackback/db/types'
import { getSession } from './auth'
import { getSettings } from './workspace'
import {
  db,
  settings,
  principal,
  user,
  postStatuses,
  boards,
  eq,
  asc,
  DEFAULT_STATUSES,
} from '@/lib/server/db'

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
  useCase: z.enum(USE_CASE_TYPES).optional(),
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
 * Creates settings and default statuses.
 * Requires authentication. For fresh installs (no settings), makes the user admin.
 *
 * NOTE: Cannot use requireAuth() here because it requires settings to exist,
 * but we're creating settings. We manually check auth and handle member creation.
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

      const { workspaceName, userName, useCase } = data

      // Check if settings already exist
      const existingSettings = await getSettings()

      // Fresh install (no settings): first authenticated user becomes admin
      // Settings exist: require existing admin role
      if (!existingSettings) {
        // Fresh install - ensure user has admin member record
        const principalRecord = await db.query.principal.findFirst({
          where: eq(principal.userId, session.user.id as UserId),
        })

        if (!principalRecord) {
          // Create admin member for first user
          console.log(`[fn:onboarding] setupWorkspaceFn: creating admin member for first user`)
          await db.insert(principal).values({
            id: generateId('principal'),
            userId: session.user.id as UserId,
            role: 'admin',
            createdAt: new Date(),
          })
        } else if (principalRecord.role !== 'admin') {
          // User exists but not admin - upgrade to admin (fresh install, they're first)
          console.log(`[fn:onboarding] setupWorkspaceFn: upgrading user to admin`)
          await db
            .update(principal)
            .set({ role: 'admin' })
            .where(eq(principal.userId, session.user.id as UserId))
        }
      } else {
        // Settings exist - check setup state
        const currentSetupState: SetupState | null = existingSettings.setupState
          ? JSON.parse(existingSettings.setupState)
          : null

        // If workspace step is already complete, require admin role
        // If workspace step is NOT complete (mid-onboarding), ensure user becomes admin
        const principalRecord = await db.query.principal.findFirst({
          where: eq(principal.userId, session.user.id as UserId),
        })

        if (currentSetupState?.steps?.workspace) {
          // Workspace already set up - require existing admin
          if (!principalRecord || principalRecord.role !== 'admin') {
            throw new Error('Only admin can complete setup')
          }
        } else {
          // Mid-onboarding - ensure user is admin
          if (!principalRecord) {
            console.log(
              `[fn:onboarding] setupWorkspaceFn: creating admin member for onboarding user`
            )
            await db.insert(principal).values({
              id: generateId('principal'),
              userId: session.user.id as UserId,
              role: 'admin',
              createdAt: new Date(),
            })
          } else if (principalRecord.role !== 'admin') {
            console.log(`[fn:onboarding] setupWorkspaceFn: upgrading user to admin`)
            await db
              .update(principal)
              .set({ role: 'admin' })
              .where(eq(principal.userId, session.user.id as UserId))
          }
        }
      }

      // Parse existing setupState if present
      let setupState: SetupState | null = existingSettings?.setupState
        ? JSON.parse(existingSettings.setupState)
        : null

      // Check if onboarding is already complete
      if (setupState?.steps?.core && setupState?.steps?.workspace && setupState?.steps?.boards) {
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

      let finalSettings = existingSettings

      // Settings exist: update name/slug and mark workspace step complete
      if (existingSettings) {
        console.log(`[fn:onboarding] setupWorkspaceFn: updating existing settings`)

        // Generate slug from workspace name
        const slug = workspaceName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')

        if (slug.length < 2) {
          throw new Error('Invalid workspace name - cannot generate valid slug')
        }

        // Update setupState to mark workspace step as complete
        if (setupState && !setupState.steps.workspace) {
          const updatedState: SetupState = {
            ...setupState,
            steps: {
              ...setupState.steps,
              workspace: true,
            },
            useCase: useCase ?? setupState.useCase,
          }
          await db
            .update(settings)
            .set({
              name: workspaceName.trim(),
              slug,
              setupState: JSON.stringify(updatedState),
              // Set default configs if not already set
              portalConfig:
                existingSettings.portalConfig ??
                JSON.stringify({
                  oauth: { google: true, github: true },
                  features: { publicView: true, submissions: true, comments: true, voting: true },
                }),
              authConfig:
                existingSettings.authConfig ??
                JSON.stringify({
                  oauth: { google: true, github: true },
                  openSignup: true,
                }),
            })
            .where(eq(settings.id, existingSettings.id))
          console.log(
            `[fn:onboarding] setupWorkspaceFn: updated name=${workspaceName}, slug=${slug}, workspace=true`
          )
        }

        finalSettings = await getSettings()
      } else {
        // Self-hosted: create settings from scratch
        // Generate slug from workspace name
        const slug = workspaceName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')

        if (slug.length < 2) {
          throw new Error('Invalid workspace name - cannot generate valid slug')
        }

        // Initial setupState for self-hosted (workspace step done after this fn completes)
        setupState = {
          version: 1,
          steps: {
            core: true,
            workspace: true,
            boards: false,
          },
          source: 'self-hosted',
          useCase,
        }

        // Create settings
        // Note: Not using transaction because neon-http driver doesn't support interactive transactions.
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
              oauth: { google: true, github: true },
              openSignup: true,
            }),
            setupState: JSON.stringify(setupState),
          })
          .returning()

        finalSettings = createdSettings
        console.log(`[fn:onboarding] setupWorkspaceFn: created settings for self-hosted instance`)
      }

      // Create default post statuses if none exist
      const existingStatuses = await db.query.postStatuses.findFirst()
      if (!existingStatuses) {
        const statusValues = DEFAULT_STATUSES.map((status) => ({
          id: generateId('status') as StatusId,
          ...status,
          createdAt: new Date(),
        }))
        await db.insert(postStatuses).values(statusValues)
        console.log(
          `[fn:onboarding] setupWorkspaceFn: created ${statusValues.length} default statuses`
        )
      }

      console.log(
        `[fn:onboarding] setupWorkspaceFn: id=${finalSettings!.id}, slug=${finalSettings!.slug}`
      )
      return {
        id: finalSettings!.id,
        name: finalSettings!.name,
        slug: finalSettings!.slug,
      }
    } catch (error) {
      console.error(`[fn:onboarding] ❌ setupWorkspaceFn failed:`, error)
      throw error
    }
  })

/**
 * Save user name during onboarding.
 * Called after OTP verification if user doesn't have a name set.
 */
export const saveUserNameFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(2, 'Name must be at least 2 characters').max(100),
    })
  )
  .handler(async ({ data }: { data: { name: string } }): Promise<void> => {
    console.log(`[fn:onboarding] saveUserNameFn`)
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      await db
        .update(user)
        .set({
          name: data.name.trim(),
          updatedAt: new Date(),
        })
        .where(eq(user.id, session.user.id as UserId))

      console.log(`[fn:onboarding] saveUserNameFn: saved name for user ${session.user.id}`)
    } catch (error) {
      console.error(`[fn:onboarding] ❌ saveUserNameFn failed:`, error)
      throw error
    }
  })

/**
 * Save use case selection during onboarding.
 * Stores the use case in setupState for board recommendations.
 * For fresh installs, creates minimal settings to store the useCase.
 */
export const saveUseCaseFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ useCase: z.enum(USE_CASE_TYPES) }))
  .handler(async ({ data }: { data: { useCase: UseCaseType } }): Promise<void> => {
    console.log(`[fn:onboarding] saveUseCaseFn: useCase=${data.useCase}`)
    try {
      const session = await getSession()
      if (!session?.user) {
        throw new Error('Authentication required')
      }

      const existingSettings = await getSettings()

      if (existingSettings) {
        // Update existing settings with useCase
        const setupState: SetupState = existingSettings.setupState
          ? JSON.parse(existingSettings.setupState)
          : { version: 1, steps: { core: true, workspace: false, boards: false }, source: 'cloud' }

        const updatedState: SetupState = {
          ...setupState,
          useCase: data.useCase,
        }

        await db
          .update(settings)
          .set({ setupState: JSON.stringify(updatedState) })
          .where(eq(settings.id, existingSettings.id))

        // Ensure user has admin member record (for cases where settings exist but member doesn't)
        if (!setupState.steps.workspace) {
          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.userId, session.user.id as UserId),
          })

          if (!principalRecord) {
            await db.insert(principal).values({
              id: generateId('principal'),
              userId: session.user.id as UserId,
              role: 'admin',
              createdAt: new Date(),
            })
            console.log(`[fn:onboarding] saveUseCaseFn: created admin member for user`)
          }
        }

        console.log(`[fn:onboarding] saveUseCaseFn: saved useCase=${data.useCase}`)
      } else {
        // Fresh self-hosted install: create minimal settings to store useCase
        // The workspace step will update name/slug later
        const setupState: SetupState = {
          version: 1,
          steps: {
            core: true,
            workspace: false,
            boards: false,
          },
          source: 'self-hosted',
          useCase: data.useCase,
        }

        await db.insert(settings).values({
          id: generateId('workspace'),
          name: 'My Workspace', // Placeholder, will be updated in workspace step
          slug: 'workspace',
          createdAt: new Date(),
          setupState: JSON.stringify(setupState),
        })

        // Ensure user has admin member record for fresh install
        const principalRecord = await db.query.principal.findFirst({
          where: eq(principal.userId, session.user.id as UserId),
        })

        if (!principalRecord) {
          await db.insert(principal).values({
            id: generateId('principal'),
            userId: session.user.id as UserId,
            role: 'admin',
            createdAt: new Date(),
          })
          console.log(`[fn:onboarding] saveUseCaseFn: created admin member for first user`)
        }

        console.log(
          `[fn:onboarding] saveUseCaseFn: created initial settings with useCase=${data.useCase}`
        )
      }
    } catch (error) {
      console.error(`[fn:onboarding] ❌ saveUseCaseFn failed:`, error)
      throw error
    }
  })

/**
 * List existing boards during onboarding.
 * This is a simpler version that doesn't require full auth context.
 */
export const listBoardsForOnboarding = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:onboarding] listBoardsForOnboarding`)
  try {
    const boardList = await db.query.boards.findMany({
      orderBy: [asc(boards.name)],
    })
    return boardList.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
    }))
  } catch (error) {
    console.error(`[fn:onboarding] ❌ listBoardsForOnboarding failed:`, error)
    return []
  }
})
