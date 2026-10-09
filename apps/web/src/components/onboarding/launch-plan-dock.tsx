import { useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { useSessionContext, useUserRole } from '@/lib/client/hooks/use-root-context'
import type { OnboardingProgress } from '@/lib/server/onboarding-progress'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isAdmin } from '@/lib/shared/roles'

type Checklist = typeof import('@/lib/shared/launch-checklist')

type SidebarLaunch = ReturnType<Checklist['launchPlanProgress']> & {
  /** Whether the dock shows: the plan is open, or its first win is not dismissed yet. */
  shown: boolean
  /** Whether Help offers the Launch plan page: a step of the plan is still open. */
  inHelp: boolean
}

const STORAGE_PREFIX = 'quackback:launch-plan-dock:'
/** This person's first-run markers, which Home loads for its tour offer and first win. */
const PROGRESS_KEY = ['onboarding', 'progress'] as const

function readStored(key: string): SidebarLaunch | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<SidebarLaunch> | null
    if (!value || typeof value.step !== 'number' || typeof value.total !== 'number') return null
    const resolved = value.resolved === true
    return {
      step: value.step,
      total: value.total,
      resolved,
      shown: typeof value.shown === 'boolean' ? value.shown : !resolved,
      inHelp: typeof value.inHelp === 'boolean' ? value.inHelp : !resolved,
    }
  } catch {
    return null
  }
}

function writeStored(key: string, value: SidebarLaunch) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the sidebar then shows only where the plan is loaded.
  }
}

/** The sidebar's view of the plan from a loaded launch status. */
function sidebarLaunch(
  checklist: Checklist,
  status: LaunchStatus,
  progress: OnboardingProgress | undefined,
  stored: SidebarLaunch | null
): SidebarLaunch {
  const count = checklist.launchPlanProgress(status)
  const inHelp = Boolean(status.launchWindow) && checklist.launchPlanHasOpenSteps(status)
  // Outside the launch window the plan is over, whatever its state.
  if (status.inLaunchWindow === false) return { ...count, resolved: true, shown: false, inHelp }
  if (!count.resolved) return { ...count, shown: true, inHelp }
  // After the win the dock stays until the win is dismissed. Where that marker
  // is not loaded, keep what the dock knew if it already saw the win.
  const shown = progress ? !progress.firstWinShownAt : stored?.resolved ? stored.shown : true
  return { ...count, shown, inHelp }
}

/**
 * The launch plan as the sidebar shows it. The sidebar is on every admin
 * page, so it never fetches: it reads what Home and the Launch plan page
 * loaded, and remembers the last state it saw for every other page.
 */
function useSidebarLaunch(): SidebarLaunch | null {
  // The plan is the owner's: a teammate who joins later has their own first run.
  const role = useUserRole()
  const canView = usePermission(PERMISSIONS.MEMBER_VIEW) && isAdmin(role)
  const userId = useSessionContext()?.user?.id
  const storageKey = canView && userId ? `${STORAGE_PREFIX}${userId}` : null
  const { data } = useQuery({ ...adminQueries.onboardingStatus(), enabled: false })
  const { data: progress } = useQuery<OnboardingProgress>({
    queryKey: PROGRESS_KEY,
    enabled: false,
  })
  const [state, setState] = useState<SidebarLaunch | null>(null)

  useEffect(() => {
    if (!storageKey) return
    const stored = readStored(storageKey)
    if (!data) {
      setState(stored)
      return
    }
    // The checklist is the whole task catalogue: it loads only once a page has
    // loaded the status, so the rail never carries it.
    let active = true
    void import('@/lib/shared/launch-checklist').then((checklist) => {
      if (!active) return
      const next = sidebarLaunch(checklist, data, progress, stored)
      writeStored(storageKey, next)
      setState(next)
    })
    return () => {
      active = false
    }
  }, [data, progress, storageKey])

  return storageKey ? state : null
}

/**
 * The sidebar's way back to the Launch plan page while the plan is open, and
 * after the first win until it is dismissed.
 */
export function LaunchPlanDock() {
  const dock = useSidebarLaunch()
  if (!dock?.shown) return null
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
 * Help's Launch plan item: shown to an admin of a workspace that had a launch
 * plan, while any of its steps is still open, the optional ones after the
 * first win included. It mounts with the menu, so the sidebar never waits on it.
 */
export function LaunchPlanInHelp({ children }: { children: ReactNode }) {
  return useSidebarLaunch()?.inHelp ? children : null
}
