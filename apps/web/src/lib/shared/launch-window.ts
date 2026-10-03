import type { SetupState } from '@/lib/shared/db-types'

/**
 * The launch window: the first weeks after a workspace finishes setup. First-run
 * behaviour (the tour offer, the try-it cards, the first-win celebration and the
 * prominent launch plan on Home) applies only inside it, so a workspace that
 * was already running before these existed never sees them after an upgrade.
 */
export const LAUNCH_WINDOW_DAYS = 14

const WINDOW_MS = LAUNCH_WINDOW_DAYS * 86_400_000

export interface LaunchWindow {
  startsAt: string
  endsAt: string
}

function toTime(value: string | Date | null | undefined): number | null {
  if (value == null) return null
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/** When setup finished: the earliest completion the setup state records. */
export function setupCompletedAt(state: SetupState | null | undefined): string | null {
  if (!state) return null
  const times = [state.completedAt, state.steps.startingPoint?.completedAt]
    .map((value) => toTime(value))
    .filter((time): time is number => time !== null)
  return times.length ? new Date(Math.min(...times)).toISOString() : null
}

/**
 * The workspace's launch window, or null when it has none. Setup must have
 * finished within the window of the workspace's creation: a workspace whose
 * completion is first stamped long after it was created (an established
 * workspace upgraded into the setup-state format) is not launching.
 */
export function launchWindowFor(input: {
  setupState: SetupState | null | undefined
  workspaceCreatedAt: string | Date | null | undefined
}): LaunchWindow | null {
  const started = toTime(setupCompletedAt(input.setupState))
  const created = toTime(input.workspaceCreatedAt)
  if (started === null || created === null) return null
  if (started - created > WINDOW_MS) return null
  return {
    startsAt: new Date(started).toISOString(),
    endsAt: new Date(started + WINDOW_MS).toISOString(),
  }
}

export function isLaunchWindowOpen(
  window: LaunchWindow | null | undefined,
  now: number | Date = Date.now()
): boolean {
  if (!window) return false
  const time = now instanceof Date ? now.getTime() : now
  return time >= Date.parse(window.startsAt) && time <= Date.parse(window.endsAt)
}

/** A first win worth celebrating landed after setup finished, inside the window. */
export function isFirstWinInLaunchWindow(
  firstWinAt: string | null | undefined,
  window: LaunchWindow | null | undefined
): boolean {
  const reached = toTime(firstWinAt)
  if (!window || reached === null) return false
  return reached >= Date.parse(window.startsAt) && reached <= Date.parse(window.endsAt)
}
