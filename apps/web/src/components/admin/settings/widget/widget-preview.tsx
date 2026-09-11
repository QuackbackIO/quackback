import { useEffect, useRef, useState } from 'react'
import {
  createLauncher,
  type LauncherHandle,
} from '../../../../../../../packages/widget/src/core/launcher'
import { cn } from '@/lib/shared/utils'

type PreviewServerTheme = {
  theme?: {
    lightPrimary?: string
    lightPrimaryForeground?: string
    darkPrimary?: string
    darkPrimaryForeground?: string
  }
}

interface WidgetPreviewProps {
  position: 'bottom-right' | 'bottom-left'
  /** Launcher button label — the trigger renders as a pill when set. */
  label?: string
  /** Proactive greeting bubble beside the launcher. Hidden when empty. */
  greeting?: string
  /** Preview theme — forwarded to the widget iframe as a forced theme. */
  theme?: 'light' | 'dark'
  /**
   * Remount signal for the iframe: pass a value derived from the persisted
   * widget config so the embedded widget reloads whenever a setting saves.
   */
  refreshKey?: string
}

function applyLauncherTheme(
  handle: LauncherHandle,
  theme: 'light' | 'dark',
  config: PreviewServerTheme
) {
  const t = config.theme
  if (!t) return
  const dark = theme === 'dark'
  handle.setColors({
    backgroundColor: dark ? (t.darkPrimary ?? t.lightPrimary) : t.lightPrimary,
    foregroundColor: dark
      ? (t.darkPrimaryForeground ?? t.lightPrimaryForeground)
      : t.lightPrimaryForeground,
  })
}

/**
 * Live preview of the embedded widget: the real `/widget` app in an iframe
 * (the same document the customer-facing SDK frames) and the real SDK
 * launcher button, on a fake page. Only the page behind it is simulated.
 */
export function WidgetPreview({
  position,
  label,
  greeting,
  theme = 'light',
  refreshKey,
}: WidgetPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<LauncherHandle | null>(null)
  const themeConfigRef = useRef<PreviewServerTheme | null>(null)
  const [isOpen, setIsOpen] = useState(true)
  const onRight = position !== 'bottom-left'

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handle = createLauncher({
      placement: onRight ? 'right' : 'left',
      root: host,
      onClick: () => setIsOpen((open) => !open),
    })
    launcherRef.current = handle
    handle.setOpen(isOpen)
    handle.setLabel(label ?? '')
    handle.setGreeting(greeting ?? '')
    if (themeConfigRef.current) applyLauncherTheme(handle, theme, themeConfigRef.current)
    handle.reveal()
    return () => {
      handle.remove()
      if (launcherRef.current === handle) launcherRef.current = null
    }
    // Remount only when the corner changes. Label / greeting / open sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [onRight])

  useEffect(() => {
    launcherRef.current?.setOpen(isOpen)
  }, [isOpen])

  useEffect(() => {
    launcherRef.current?.setLabel(label ?? '')
  }, [label])

  useEffect(() => {
    launcherRef.current?.setGreeting(greeting ?? '')
  }, [greeting])

  useEffect(() => {
    if (themeConfigRef.current && launcherRef.current) {
      applyLauncherTheme(launcherRef.current, theme, themeConfigRef.current)
    }
    let cancelled = false
    void fetch('/api/widget/config.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((config: PreviewServerTheme | null) => {
        if (cancelled || !config) return
        themeConfigRef.current = config
        if (!launcherRef.current) return
        applyLauncherTheme(launcherRef.current, theme, config)
      })
      .catch(() => {
        /* keep the SDK defaults */
      })
    return () => {
      cancelled = true
    }
  }, [theme, refreshKey])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const msg = event.data as { type?: string; count?: number } | null
      if (msg?.type === 'quackback:close') setIsOpen(false)
      if (msg?.type === 'quackback:unread') {
        launcherRef.current?.setUnread(typeof msg.count === 'number' ? msg.count : 0)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className={cn('h-full', theme === 'dark' && 'dark')}>
      <div className="relative h-full min-h-[560px] rounded-xl border border-border bg-muted/30 overflow-hidden text-foreground">
        <PageBackdrop />

        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div ref={hostRef} className="relative h-[688px] w-[400px] max-h-full max-w-full">
            {isOpen && (
              <div
                className={cn(
                  'absolute inset-x-0 top-0 bottom-[88px] z-10',
                  'rounded-2xl border border-border bg-background shadow-2xl overflow-hidden'
                )}
              >
                <iframe
                  key={refreshKey}
                  src={`/widget?theme=${theme}`}
                  title="Widget preview"
                  allow="clipboard-write"
                  className="h-full w-full border-0"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PageBackdrop() {
  return (
    <div className="absolute inset-0 p-4 pointer-events-none select-none opacity-40">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-muted-foreground/20" />
          <div className="w-16 h-2.5 rounded-full bg-muted-foreground/15" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
        </div>
      </div>
      <div className="mt-8 mb-6 space-y-2 max-w-[60%]">
        <div className="w-48 h-3 rounded-full bg-muted-foreground/15" />
        <div className="w-36 h-3 rounded-full bg-muted-foreground/10" />
        <div className="w-full h-2 rounded-full bg-muted-foreground/8 mt-3" />
        <div className="w-4/5 h-2 rounded-full bg-muted-foreground/8" />
      </div>
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-muted-foreground/10 p-3 space-y-2">
            <div className="w-8 h-8 rounded bg-muted-foreground/10" />
            <div className="w-full h-2 rounded-full bg-muted-foreground/10" />
            <div className="w-3/4 h-2 rounded-full bg-muted-foreground/8" />
          </div>
        ))}
      </div>
    </div>
  )
}
