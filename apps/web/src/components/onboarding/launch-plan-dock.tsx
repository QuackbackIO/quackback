import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { useSessionContext, useUserRole } from '@/lib/client/hooks/use-root-context'
import {
  launchPlanHasOpenSteps,
  launchPlanProgress,
  type LaunchStatus,
} from '@/lib/shared/launch-checklist'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isAdmin } from '@/lib/shared/roles'
import { onboardingProgressQuery } from './use-launch-plan'

type DockProgress = ReturnType<typeof launchPlanProgress> & {
  /** Whether the dock shows: the plan is open, or its first win is not dismissed yet. */
  shown: boolean
}

const STORAGE_PREFIX = 'quackback:launch-plan-dock:'

function readStored(key: string): DockProgress | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<DockProgress> | null
    if (!value || typeof value.step !== 'number' || typeof value.total !== 'number') return null
    const resolved = value.resolved === true
    return {
      step: value.step,
      total: value.total,
      resolved,
      shown: typeof value.shown === 'boolean' ? value.shown : !resolved,
    }
  } catch {
    return null
  }
}

function writeStored(key: string, value: DockProgress) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the dock then waits for the launch status.
  }
}

/** The plan is the owner's: a teammate who joins later has their own first run. */
function useCanSeePlan(): boolean {
  const role = useUserRole()
  return usePermission(PERMISSIONS.MEMBER_VIEW) && isAdmin(role)
}

/**
 * The launch status for the sidebar: read once as an admin page loads and
 * again whenever the window regains focus, so a tab left open elsewhere
 * catches up with a step done or a first win in another tab.
 */
function useSidebarLaunchStatus(enabled: boolean): LaunchStatus | undefined {
  return useQuery({ ...adminQueries.onboardingStatus(), enabled, refetchOnWindowFocus: true }).data
}

/**
 * The sidebar's way back to the Launch plan page while the plan is open, and
 * after the first win until it is dismissed. It remembers the last progress
 * it saw, so a reload shows it straight away while the status loads.
 */
export function LaunchPlanDock() {
  const canView = useCanSeePlan()
  const userId = useSessionContext()?.user?.id
  const data = useSidebarLaunchStatus(canView)
  const winOpen = data?.hasFirstWin === true && data.inLaunchWindow === true
  // Whether this person dismissed the first win, asked only once there is one.
  const { data: progress } = useQuery({ ...onboardingProgressQuery(), enabled: canView && winOpen })
  const [dock, setDock] = useState<DockProgress | null>(null)
  const storageKey = userId ? `${STORAGE_PREFIX}${userId}` : null

  useEffect(() => {
    if (!canView || !storageKey) return
    if (!data) {
      setDock(readStored(storageKey))
      return
    }
    const count = launchPlanProgress(data)
    // Outside the launch window the plan is over, whatever its state.
    if (data.inLaunchWindow === false) {
      const over = { ...count, resolved: true, shown: false }
      writeStored(storageKey, over)
      setDock(over)
      return
    }
    // After the win, wait to hear whether it was dismissed before deciding.
    if (count.resolved && !progress) return
    const next = { ...count, shown: !count.resolved || !progress?.firstWinShownAt }
    writeStored(storageKey, next)
    setDock(next)
  }, [canView, data, progress, storageKey])

  if (!canView || !dock?.shown) return null
  // The live page is step 1 and starts done; the bar shows the steps behind you.
  const percent = dock.resolved
    ? 100
    : dock.total > 0
      ? Math.round(((dock.step - 1) / dock.total) * 100)
      : 0
  return (
    <Link
      to="/admin/getting-started"
      className="mb-2 flex flex-col gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">
          <FormattedMessage id="onboarding.launch.name" defaultMessage="Launch plan" />
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {dock.resolved ? (
            <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
          ) : (
            <FormattedMessage
              id="onboarding.launch.stepOf"
              defaultMessage="Step {step} of {total}"
              values={{ step: dock.step, total: dock.total }}
            />
          )}
        </span>
      </span>
      <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full bg-foreground/10">
        <span
          className="block h-full rounded-full bg-foreground motion-safe:transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </span>
    </Link>
  )
}

/**
 * Whether Help offers the Launch plan page: to an admin of a workspace that
 * had a launch plan, while any of its steps is still open, the optional ones
 * after the first win included.
 */
export function useLaunchPlanInHelp(): boolean {
  const canView = useCanSeePlan()
  const data = useSidebarLaunchStatus(canView)
  if (!canView || !data?.launchWindow) return false
  return launchPlanHasOpenSteps(data)
}
