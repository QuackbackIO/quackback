import { useState, useEffect } from 'react'
import { XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { getLatestVersion, isNewerVersion } from '@/lib/server/functions/version'

const DISMISSED_VERSION_KEY = 'quackback_dismissed_version'
const CHANGELOG_URL = 'https://feedback.quackback.io/changelog'

interface UpdateInfo {
  version: string
  releaseUrl: string
}

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

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkVersion() {
      const latest = await getLatestVersion()
      if (cancelled || !latest) return

      if (isNewerVersion(__APP_VERSION__, latest.version)) {
        const dismissedVersion = getDismissedVersion()
        if (dismissedVersion && !isNewerVersion(dismissedVersion, latest.version)) {
          // Already dismissed this version (or a newer one)
          return
        }
        setUpdate(latest)
      }
    }

    checkVersion()
    return () => {
      cancelled = true
    }
  }, [])

  if (!update || dismissed) return null

  const handleDismiss = () => {
    setDismissedVersion(update.version)
    setDismissed(true)
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm bg-primary/5 border-b border-primary/10">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium text-foreground shrink-0">
          Quackback v{update.version} is available
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
            href={update.releaseUrl}
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
  )
}
