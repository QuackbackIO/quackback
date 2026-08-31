import { useEffect, useState } from 'react'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

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

/**
 * Live preview of the embedded widget: the real `/widget` app in an iframe
 * (the same document the customer-facing SDK frames), surrounded by the same
 * chrome the SDK provides on a host page — a launcher button and the page
 * behind it. Only the chrome is simulated; everything inside the panel is the
 * production widget with real settings and content.
 */
export function WidgetPreview({
  position,
  label,
  greeting,
  theme = 'light',
  refreshKey,
}: WidgetPreviewProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [greetingDismissed, setGreetingDismissed] = useState(false)
  const greetingText = greeting?.trim() || ''
  const onRight = position !== 'bottom-left'
  // Same corner stack as the SDK: greeting sits above the launcher, and the
  // open panel covers that corner so the bubble hides.
  const showGreeting = greetingText.length > 0 && !greetingDismissed && !isOpen
  const corner = onRight ? 'right-6' : 'left-6'

  useEffect(() => {
    setGreetingDismissed(false)
  }, [greetingText])

  // The widget's in-panel close button messages its host (the SDK on a real
  // page); here the preview is the host, so honour it the same way.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const msg = event.data as { type?: string } | null
      if (msg?.type === 'quackback:close') setIsOpen(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className={cn('h-full', theme === 'dark' && 'dark')}>
      <div className="relative h-full min-h-[560px] rounded-xl border border-border bg-muted/30 overflow-hidden text-foreground">
        {/* Simulated page background */}
        <PageBackdrop />

        {/* Widget panel — same corner as the launcher, sitting just above it
            (SDK: bottom 88px, side 24px, 400×600). */}
        {isOpen && (
          <div
            className={cn(
              'absolute z-10 w-[400px] max-w-[calc(100%-3rem)] h-[600px] max-h-[calc(100%-7rem)]',
              'rounded-2xl border border-border bg-background shadow-2xl overflow-hidden',
              'bottom-[88px]',
              corner
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

        {/* Greeting bubble — same corner, just above the launcher. Hidden
            while the panel is open, matching the host-page SDK. */}
        {showGreeting && (
          <div
            className={cn(
              'absolute bottom-[84px] z-10 flex max-w-[220px] items-center gap-2 rounded-[14px] px-3 py-2.5',
              'bg-white text-[13px] leading-snug text-zinc-900 shadow-lg',
              corner
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 cursor-pointer text-start"
              onClick={() => setIsOpen(true)}
            >
              {greetingText}
            </button>
            <button
              type="button"
              aria-label="Dismiss greeting"
              onClick={() => setGreetingDismissed(true)}
              className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-base leading-none text-zinc-400 hover:text-zinc-600"
            >
              ×
            </button>
          </div>
        )}

        {/* Trigger button — bottom of the same corner, below the open panel. */}
        <button
          type="button"
          aria-label={isOpen ? 'Close feedback widget' : 'Open feedback widget'}
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'absolute bottom-6 z-20 flex items-center justify-center h-12 rounded-full',
            'bg-primary text-primary-foreground shadow-md',
            'transition-all hover:shadow-lg hover:-translate-y-0.5',
            label ? 'gap-1.5 ps-3 pe-4 text-xs font-semibold' : 'w-12',
            corner
          )}
        >
          <ChatBubbleOvalLeftEllipsisIcon className="w-5 h-5 shrink-0" />
          {label && <span className="max-w-40 truncate">{label}</span>}
        </button>
      </div>
    </div>
  )
}

function PageBackdrop() {
  return (
    <div className="absolute inset-0 p-4 pointer-events-none select-none opacity-40">
      {/* Nav bar */}
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
      {/* Hero */}
      <div className="mt-8 mb-6 space-y-2 max-w-[60%]">
        <div className="w-48 h-3 rounded-full bg-muted-foreground/15" />
        <div className="w-36 h-3 rounded-full bg-muted-foreground/10" />
        <div className="w-full h-2 rounded-full bg-muted-foreground/8 mt-3" />
        <div className="w-4/5 h-2 rounded-full bg-muted-foreground/8" />
      </div>
      {/* Content blocks */}
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
