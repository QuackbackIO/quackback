import { useState, useEffect } from 'react'
import { XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import type { LatestVersionResult } from '@/lib/server/functions/version'
import { setUpdateBannerDismissedVersionCookie } from '@/lib/shared/update-banner-cookie'

// Legacy localStorage key. Dismissal now lives in a cookie (readable during
// SSR — see update-banner-cookie.ts) so the banner renders in its final
// expanded/collapsed state on first paint instead of flashing expanded and
// then collapsing once client JS reads localStorage. This key is only read
// once, client-side, to migrate returning users onto the cookie.
const LEGACY_DISMISSED_VERSION_KEY = 'quackback_dismissed_version'

function getLegacyDismissedVersion(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(LEGACY_DISMISSED_VERSION_KEY)
  } catch {
    return null
  }
}

function clearLegacyDismissedVersion(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(LEGACY_DISMISSED_VERSION_KEY)
  } catch {
    // Ignore storage errors
  }
}

const CHANGELOG_URL = 'https://feedback.quackback.io/changelog'

interface UpdateBannerProps {
  latestVersion: LatestVersionResult | null
  /** Version the banner was dismissed for, read from the SSR cookie
   *  (see update-banner-cookie.ts). Drives the initial render so the banner
   *  never flashes expanded before collapsing. */
  dismissedVersion: string | null
}

export function UpdateBanner({ latestVersion, dismissedVersion }: UpdateBannerProps) {
  const isDismissed = Boolean(
    latestVersion && dismissedVersion && dismissedVersion === latestVersion.version
  )
  const [open, setOpen] = useState(() => Boolean(latestVersion) && !isDismissed)

  useEffect(() => {
    // One-time migration for returning users who dismissed the banner before
    // this cookie existed: treat the old localStorage key as authoritative,
    // collapse immediately, persist it to the cookie, and clear the legacy
    // key so this codepath doesn't keep running on every mount.
    if (!latestVersion || isDismissed) return
    const legacyDismissedVersion = getLegacyDismissedVersion()
    if (legacyDismissedVersion === latestVersion.version) {
      setUpdateBannerDismissedVersionCookie(legacyDismissedVersion)
      clearLegacyDismissedVersion()
      setOpen(false)
    }
  }, [latestVersion, isDismissed])

  if (!latestVersion) return null

  const handleDismiss = () => {
    setUpdateBannerDismissedVersionCookie(latestVersion.version)
    clearLegacyDismissedVersion()
    setOpen(false)
  }

  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-out"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm bg-primary/5 border-b border-primary/10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-foreground shrink-0">
              Quackback v{latestVersion.version} is available
            </span>
            <span className="text-muted-foreground hidden sm:inline">—</span>
            <div className="hidden sm:flex items-center gap-2 text-muted-foreground">
              <a
                href={CHANGELOG_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                See what's new
                <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </a>
              <span>·</span>
              <a
                href={latestVersion.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                Release notes
                <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </a>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss update notification"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
