/**
 * Server functions for board operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { BoardId } from '@quackback/ids'
import type { BoardSettings, SetupState } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { getSettings } from './workspace'
import { db, settings, boards, eq } from '@/lib/server/db'
import {
  listBoards,
  getBoardById,
  createBoard,
  updateBoard,
  deleteBoard,
} from '@/lib/server/domains/boards/board.service'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { boardAccessSchema, boardPresetSchema, accessForPreset } from '@/lib/shared/schemas/boards'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

// Re-export for back-compat: existing test imports `boardAccessSchema`
// from '../boards'. The actual definition lives in @/lib/shared/schemas/boards
// alongside the other board schemas, keeping it out of the client → server
// import-protection chain.
export { boardAccessSchema }

const log = logger.child({ component: 'boards' })

// ============================================
// Schemas
// ============================================

const createBoardSchema = z.object({
  name: z
    .string()
    .min(1, 'Board name is required')
    .max(100, 'Board name must be 100 characters or less'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  // Two-preset selector the admin create dialog renders as tiles. Mapped
  // to a BoardAccess matrix via accessForPreset(). Richer tier choices
  // (authenticated, segments[], asymmetric matrices) land via
  // updateBoardAccessFn after the board exists — admin-only, audited.
  preset: boardPresetSchema.default('public'),
})

const getBoardSchema = z.object({
  id: z.string(),
})

const boardSettingsSchema = z
  .object({
    roadmapStatusIds: z.array(z.string()).optional(),
  })
  .strict()

const updateBoardSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  // Visibility (access + moderation) is NOT accepted here — those are
  // policy changes, admin-only via updateBoardAccessFn. If we accepted
  // access on this team-level path, members could grant/revoke board
  // visibility despite the access-control split.
  settings: boardSettingsSchema.optional(),
})

const deleteBoardSchema = z.object({
  id: z.string(),
})

const createBoardsBatchSchema = z.object({
  boards: z
    .array(
      z.object({
        name: z
          .string()
          .min(1, 'Board name is required')
          .max(100, 'Board name must be 100 characters or less'),
        description: z.string().max(500).optional(),
      })
    )
    .max(10, 'Maximum 10 boards can be created at once'),
})

// ============================================
// Type Exports
// ============================================

export type CreateBoardInput = z.infer<typeof createBoardSchema>
export type GetBoardInput = z.infer<typeof getBoardSchema>
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>
export type DeleteBoardInput = z.infer<typeof deleteBoardSchema>
export type CreateBoardsBatchInput = z.infer<typeof createBoardsBatchSchema>

// ============================================
// Read Operations
// ============================================

function serializeBoard(b: Awaited<ReturnType<typeof listBoards>>[number]) {
  return {
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }
}

/**
 * List all boards for the authenticated user's workspace
 */
export const fetchBoardsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug({}, 'fetch boards')
  await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

  const boards = await listBoards()
  log.debug({ count: boards.length }, 'fetch boards')
  return boards.map(serializeBoard)
})

/**
 * Get a single board by ID
 */
export const fetchBoardFn = createServerFn({ method: 'GET' })
  .validator(getBoardSchema)
  .handler(async ({ data }) => {
    log.debug({ board_id: data.id }, 'fetch board')
    await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

    const board = await getBoardById(data.id as BoardId)
    log.debug({ found: !!board }, 'fetch board')
    return serializeBoard(board)
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new board
 */
export const createBoardFn = createServerFn({ method: 'POST' })
  .validator(createBoardSchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name, preset: data.preset }, 'create board')
    await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

    // Map the binary preset choice (Public/Private) into a BoardAccess
    // matrix via the shared helper. For finer-grained access (segments,
    // asymmetric tiers) the admin uses updateBoardAccessFn after create —
    // that path is admin-only and audited.
    const board = await createBoard({
      name: data.name,
      description: data.description,
      access: accessForPreset(data.preset),
    })
    log.info({ board_id: board.id }, 'board created')
    return serializeBoard(board)
  })

/**
 * Update an existing board
 *
 * Updates name / description / settings only. Board visibility (access)
 * is a policy change and must go through updateBoardAccessFn (admin-only,
 * audited). Accepting access here would let member-role callers silently
 * override a segments or authenticated tier with a bare public/team one.
 */
export const updateBoardFn = createServerFn({ method: 'POST' })
  .validator(updateBoardSchema)
  .handler(async ({ data }) => {
    log.debug({ board_id: data.id }, 'update board')
    await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

    const board = await updateBoard(data.id as BoardId, {
      name: data.name,
      description: data.description,
      settings: data.settings as BoardSettings | undefined,
    })

    log.info({ board_id: board.id }, 'board updated')
    return serializeBoard(board)
  })

/**
 * Delete a board
 */
export const deleteBoardFn = createServerFn({ method: 'POST' })
  .validator(deleteBoardSchema)
  .handler(async ({ data }) => {
    log.debug({ board_id: data.id }, 'delete board')
    await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

    await deleteBoard(data.id as BoardId)
    log.info({ board_id: data.id }, 'board deleted')
    return { id: data.id }
  })

/**
 * Create multiple boards at once (for onboarding).
 * Allows empty array for skip functionality.
 * Updates setupState to mark boards step as complete.
 *
 * Tier-limit handling: if the request would exceed the tenant's
 * `maxBoards`, the call creates as many as fit (in input order) and
 * returns a `limited` flag — rather than throwing partway through and
 * leaving orphan boards behind. The wizard's boards step is treated
 * as "done" once the user has clicked Continue, regardless of how many
 * we ended up creating; otherwise a tenant on a 1-board plan who tries
 * to seed two would get stuck on /onboarding/boards forever.
 */
export const createBoardsBatchFn = createServerFn({ method: 'POST' })
  .validator(createBoardsBatchSchema)
  .handler(async ({ data }) => {
    log.debug({ count: data.boards.length }, 'create boards batch')
    await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })

    // Pre-flight against the tier limit so we never call createBoard
    // (which throws on overage) past capacity. This means the loop is
    // exception-free under the maxBoards gate, and any boards the user
    // selected beyond the cap are silently dropped — the UI already
    // surfaces the limit warning above the list, so a partial create is
    // the expected outcome.
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const { listBoards } = await import('@/lib/server/domains/boards/board.service')
    const [limits, existingBoards] = await Promise.all([getTierLimits(), listBoards()])
    const remainingCapacity =
      limits.maxBoards == null ? Infinity : Math.max(0, limits.maxBoards - existingBoards.length)
    const toCreate = data.boards.slice(0, remainingCapacity)
    const limited = toCreate.length < data.boards.length

    const createdBoards = []
    for (const boardInput of toCreate) {
      const board = await createBoard({
        name: boardInput.name,
        description: boardInput.description,
        // Onboarding-batch boards default to the Public preset
        // (view=anonymous, vote/comment/submit=authenticated). Admins can
        // lock them down later via updateBoardAccessFn. Without this the
        // column default (all 'anonymous') would apply, which is more
        // permissive than the create-modal's Public tile.
        access: accessForPreset('public'),
      })
      createdBoards.push(serializeBoard(board))
    }

    if (data.boards.length === 0) {
      log.debug({}, 'boards batch skipped')
    } else if (limited) {
      log.info(
        { count: createdBoards.length, requested: data.boards.length },
        'boards batch created (tier limit)'
      )
    } else {
      log.info({ count: createdBoards.length }, 'boards batch created')
    }

    // Update setupState to mark boards step as complete (and onboarding as finished).
    // Always runs after the create loop — partial creates are still a successful
    // pass through the boards step from the wizard's perspective.
    const currentSettings = await getSettings()
    if (currentSettings?.setupState) {
      const setupState: SetupState = JSON.parse(currentSettings.setupState)

      if (!setupState.steps.boards) {
        const updatedState: SetupState = {
          ...setupState,
          steps: {
            ...setupState.steps,
            boards: true,
          },
          completedAt: new Date().toISOString(),
        }
        await db
          .update(settings)
          .set({ setupState: JSON.stringify(updatedState) })
          .where(eq(settings.id, currentSettings.id))
        await invalidateSettingsCache()
        log.info({}, 'onboarding complete')
      }
    }

    return { boards: createdBoards, limited }
  })

// ============================================
// v1 access controls — board access matrix
// ============================================

import { NotFoundError } from '@/lib/shared/errors'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'

const updateBoardAccessSchema = z.object({
  boardId: z.string(),
  access: boardAccessSchema,
})

/**
 * Update board access policy.
 *
 * isAdmin-gated — granting/revoking access is policy-level work. Members can
 * moderate posts (approve/reject) but not change who sees the board.
 *
 * Accepts a per-action tier matrix (BoardAccess). Each call records a
 * `board.access.changed` audit event capturing the before/after access shape.
 */
export const updateBoardAccessFn = createServerFn({ method: 'POST' })
  .validator(updateBoardAccessSchema.parse)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.BOARD_MANAGE })
    const before = await db.query.boards.findFirst({
      where: eq(boards.id, data.boardId as BoardId),
    })
    if (!before) throw new NotFoundError('BOARD_NOT_FOUND', `Board ${data.boardId} not found`)

    await db
      .update(boards)
      .set({ access: data.access })
      .where(eq(boards.id, data.boardId as BoardId))

    await recordAuditEvent({
      event: 'board.access.changed',
      actor: actorFromAuth(auth),
      target: { type: 'board', id: data.boardId },
      before: { access: before.access },
      after: { access: data.access },
    })

    return { ok: true }
  })
