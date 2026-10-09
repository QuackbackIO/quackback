import {
  boards,
  eq,
  isNull,
  settings,
  statusComponents,
  type SetupState,
  type Transaction,
} from '@/lib/server/db'
import {
  flagsForGoals,
  resolveFeatureFlags,
  withNewWorkspaceFlags,
  type FeatureFlags,
} from '@/lib/server/domains/settings/settings.types'
import { featureFlagsWrite } from '@/lib/server/domains/settings/settings.service'
import { parseWidgetConfig } from '@/lib/server/domains/settings/settings.helpers'
import { ensureDefaultHelpCategory } from '@/lib/server/domains/help-center/help-center.default-category'
import { LAUNCH_WINDOW_DAYS } from '@/lib/shared/launch-window'
import { accessForPreset } from '@/lib/shared/schemas/boards'
import type { BoardAccess } from '@/lib/shared/db-types'

/** The goals a setup state stands for, falling back to its single legacy goal. */
export function setupGoals(state: SetupState): NonNullable<SetupState['goals']> {
  return state.goals?.length ? state.goals : [state.useCase ?? 'product_feedback']
}

/** Created within the launch window of now: a workspace that is still new. */
function isNewWorkspace(createdAt: Date | string | null | undefined, now = Date.now()): boolean {
  const created = createdAt == null ? NaN : new Date(createdAt).getTime()
  return !Number.isNaN(created) && now - created <= LAUNCH_WINDOW_DAYS * 86_400_000
}

/** Whether the workspace ever stored its status page settings (publish choice included). */
function hasStoredStatusSettings(metadata: string | null): boolean {
  if (!metadata) return false
  try {
    const bag = JSON.parse(metadata) as Record<string, unknown>
    return bag.statusSettings != null
  } catch {
    return false
  }
}

/** The flags a goal pass changes, as the partial a flag write takes. */
function changedFlags(before: FeatureFlags, after: FeatureFlags): Partial<FeatureFlags> {
  const changed: Partial<FeatureFlags> = {}
  for (const key of Object.keys(after) as Array<keyof FeatureFlags>) {
    if (after[key] !== before[key]) changed[key] = after[key]
  }
  return changed
}

/** A JSON value with its object keys sorted, so two encodings of it compare equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
    )
  }
  return value
}

/** Whether writing `next` over a stored JSON column changes what it holds. */
function changesStoredJson(stored: string | null, next: string): boolean {
  try {
    const before = stored == null ? null : JSON.parse(stored)
    return JSON.stringify(canonical(before)) !== JSON.stringify(canonical(JSON.parse(next)))
  } catch {
    return stored !== next
  }
}

type GoalRow = Pick<
  typeof settings.$inferSelect,
  'id' | 'name' | 'featureFlags' | 'createdAt' | 'metadata' | 'widgetConfig' | 'portalConfig'
>

/**
 * Apply every chosen goal at the end of setup: turn on each goal's modules
 * (never turning any off), give each goal a live page and prepare the
 * feedback board. Flags go through the same write as Settings > General, so
 * choosing Status publishes the page and choosing Support opens Messenger.
 * A new workspace whose row was created without flags (an operator
 * provisioned it) also gets the flags new workspaces start with; an
 * established workspace never does.
 *
 * `modulesChanged` reports whether any of the settings the admin keeps in
 * its root context changed (flags, status publish, Messenger, portal), so
 * the caller knows to reload them.
 */
export async function applyOnboardingGoals(
  tx: Transaction,
  row: GoalRow,
  state: SetupState
): Promise<{ modulesChanged: boolean }> {
  const goals = setupGoals(state)
  const before = resolveFeatureFlags(row.featureFlags)
  const isNew = isNewWorkspace(row.createdAt)
  const base = isNew ? withNewWorkspaceFlags(row.featureFlags, before, goals) : before
  const { flags } = flagsForGoals(base, goals)
  let modulesChanged = JSON.stringify(flags) !== JSON.stringify(before)
  // A new workspace may have been provisioned with its goal modules already
  // on but without what turning them on does (Messenger, the portal support
  // surface, the help tab), so for it those modules count as turning on now.
  const from: FeatureFlags = isNew
    ? {
        ...flags,
        ...(goals.includes('customer_support') && { supportInbox: false, supportTickets: false }),
        ...(goals.includes('help_center') && { helpCenter: false }),
        statusPage: before.statusPage,
      }
    : before
  const input = changedFlags(from, flags)
  // A status page provisioned with its flag already on was never published:
  // publish it unless the workspace has stored a choice of its own.
  if (goals.includes('status_page') && flags.statusPage && !hasStoredStatusSettings(row.metadata)) {
    input.statusPage = true
  }
  if (modulesChanged || Object.keys(input).length > 0 || isNew) {
    const patch: Record<string, string> = featureFlagsWrite(
      { ...row, featureFlags: JSON.stringify(from) },
      input
    ).patch
    // A new workspace without the Feedback goal has no board to send
    // Messenger visitors to, so it starts without the idea tab.
    if (isNew && !goals.includes('product_feedback')) {
      const widget = parseWidgetConfig(patch.widgetConfig ?? row.widgetConfig)
      if (widget.tabs?.feedback !== false) {
        patch.widgetConfig = JSON.stringify({
          ...widget,
          tabs: { ...widget.tabs, feedback: false },
        })
      }
    }
    if (isNew && goals.includes('product_feedback')) {
      const portal = openToVisitors(patch.portalConfig ?? row.portalConfig)
      if (portal) patch.portalConfig = portal
    }
    await tx.update(settings).set(patch).where(eq(settings.id, row.id))
    // The flags may already have been on while what turning them on does was
    // not (a status page never published, Messenger never opened). Writing
    // that is a change too: the admin holds these settings in its root
    // context and must reload them to show the page it now has.
    const stored = row as Record<string, unknown>
    modulesChanged ||= Object.entries(patch).some(([key, next]) =>
      changesStoredJson((stored[key] as string | null | undefined) ?? null, next)
    )
  }
  await prepareOnboardingBoard(tx, { ...state, goals })
  await seedGoalPages(tx, row.name, goals)
  return { modulesChanged }
}

/**
 * The stored portal config with visitors without an account allowed, so the
 * new feedback board takes ideas, votes and comments from anyone. Null when
 * the config already holds a choice (on or off) or cannot be read.
 */
function openToVisitors(portalConfig: string | null): string | null {
  let stored: Record<string, unknown> = {}
  if (portalConfig?.trim()) {
    try {
      const parsed: unknown = JSON.parse(portalConfig)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        stored = parsed as Record<string, unknown>
      } else if (parsed !== null) {
        return null
      }
    } catch {
      return null
    }
  }
  const features = (stored.features ?? {}) as Record<string, unknown>
  if (typeof features.allowAnonymous === 'boolean') return null
  return JSON.stringify({ ...stored, features: { ...features, allowAnonymous: true } })
}

/**
 * Give the help center and status goals something live at minute one: a
 * General category so the first article saves, and one operational service
 * named after the workspace so the status page is not empty. Only into an
 * empty module; a workspace that already has categories or services keeps
 * its own.
 */
async function seedGoalPages(
  tx: Transaction,
  workspaceName: string,
  goals: NonNullable<SetupState['goals']>
): Promise<void> {
  if (goals.includes('help_center')) {
    const anyCategory = await tx.query.helpCenterCategories.findFirst({
      where: (category, { isNull }) => isNull(category.deletedAt),
      columns: { id: true },
    })
    if (!anyCategory) await ensureDefaultHelpCategory(tx)
  }
  if (goals.includes('status_page')) {
    const anyService = await tx.query.statusComponents.findFirst({
      where: isNull(statusComponents.deletedAt),
      columns: { id: true },
    })
    if (!anyService) await tx.insert(statusComponents).values({ name: workspaceName })
  }
}

/**
 * The board a new workspace starts with: public, and open to visitors
 * without an account for ideas, votes and comments. Anonymous ideas are
 * rate limited per address on the way in.
 */
export function onboardingBoardAccess(): BoardAccess {
  return {
    ...accessForPreset('public'),
    vote: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
  }
}

/**
 * Seed an empty feedback board. Setup no longer offers a private board;
 * a workspace that chose one before keeps it.
 */
export async function prepareOnboardingBoard(tx: Transaction, state: SetupState): Promise<void> {
  if (!(state.goals ?? [state.useCase]).includes('product_feedback')) return
  const existing = await tx.query.boards.findMany({
    where: isNull(boards.deletedAt),
    columns: { id: true, slug: true, access: true },
  })
  const seeded = existing.find((board) => board.slug === 'feedback')
  if (seeded && state.feedbackPrivate && seeded.access.view !== 'team') {
    await tx
      .update(boards)
      .set({ access: accessForPreset('private') })
      .where(eq(boards.id, seeded.id))
  } else if (existing.length === 0) {
    await tx.insert(boards).values({
      name: 'Feedback',
      slug: 'feedback',
      access: state.feedbackPrivate ? accessForPreset('private') : onboardingBoardAccess(),
    })
  }
}
