import { useState, useEffect } from 'react'
import { XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import type { LatestVersionResult } from '@/lib/server/functions/version'

const DISMISSED_VERSION_KEY = 'quackback_dismissed_version'
const CHANGELOG_URL = 'https://feedback.quackback.io/changelog'

function getDismissedVersion(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(DISMISSED_VERSION_KEY)
  } catch {
    return null
  }
}

function setDismissedVersion(version: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(DISMISSED_VERSION_KEY, version)
  } catch {
    // Ignore storage errors
  }
}

interface UpdateBannerProps {
  latestVersion: LatestVersionResult | null
}

export function UpdateBanner({ latestVersion }: UpdateBannerProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!latestVersion) return
    const dismissedVersion = getDismissedVersion()
    if (!dismissedVersion || dismissedVersion !== latestVersion.version) {
      // Small delay so the collapsed state paints first
      const timer = setTimeout(() => setOpen(true), 50)
      return () => clearTimeout(timer)
    }
  }, [latestVersion])

  if (!latestVersion) return null

  const handleDismiss = () => {
    setDismissedVersion(latestVersion.version)
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
