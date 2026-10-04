import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { useSessionContext, useUserRole } from '@/lib/client/hooks/use-root-context'
import { launchPlanProgress } from '@/lib/shared/launch-checklist'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isAdmin } from '@/lib/shared/roles'

type DockProgress = ReturnType<typeof launchPlanProgress>

const STORAGE_PREFIX = 'quackback:launch-plan-dock:'

function readStored(key: string): DockProgress | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as DockProgress | null
    return value && typeof value.step === 'number' && typeof value.total === 'number' ? value : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: DockProgress) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the dock then shows only where the plan is loaded.
  }
}

/**
 * The sidebar's way back to the Launch plan page while the plan is open. It is
 * on every admin page, so it never fetches: it reads the launch status the
 * pages that already load it (Home, the Launch plan page) left in the cache,
 * and remembers the last progress it saw so a reload elsewhere keeps it.
 */
export function LaunchPlanDock() {
  // The plan is the owner's: a teammate who joins later has their own first run.
  const role = useUserRole()
  const canView = usePermission(PERMISSIONS.MEMBER_VIEW) && isAdmin(role)
  const userId = useSessionContext()?.user?.id
  const { data } = useQuery({ ...adminQueries.onboardingStatus(), enabled: false })
  const [progress, setProgress] = useState<DockProgress | null>(null)
  const storageKey = userId ? `${STORAGE_PREFIX}${userId}` : null

  useEffect(() => {
    if (!canView || !storageKey) return
    if (data) {
      // Outside the launch window the plan is over, whatever its state.
      const next =
        data.inLaunchWindow === false
          ? { ...launchPlanProgress(data), resolved: true }
          : launchPlanProgress(data)
      writeStored(storageKey, next)
      setProgress(next)
    } else {
      setProgress(readStored(storageKey))
    }
  }, [canView, data, storageKey])

  if (!canView || !progress || progress.resolved) return null
  // The live page is step 1 and starts done; the bar shows the steps behind you.
  const percent = progress.total > 0 ? Math.round(((progress.step - 1) / progress.total) * 100) : 0
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
          <FormattedMessage
            id="onboarding.launch.stepOf"
            defaultMessage="Step {step} of {total}"
            values={{ step: progress.step, total: progress.total }}
          />
        </span>
      </span>
      <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-foreground motion-safe:transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </span>
    </Link>
  )
}
