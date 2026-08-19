import { useEffect, useState } from 'react'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

interface WidgetPreviewProps {
  position: 'bottom-right' | 'bottom-left'
  /** Launcher button label — the trigger renders as a pill when set. */
  label?: string
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
  theme = 'light',
  refreshKey,
}: WidgetPreviewProps) {
  const [isOpen, setIsOpen] = useState(true)

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
      <div className="relative flex h-full min-h-[560px] items-center justify-center rounded-xl border border-border bg-muted/30 overflow-hidden text-foreground">
        {/* Simulated page background */}
        <PageBackdrop />

        {/* Widget panel — centered in the pane so it never feels cramped.
            Sized like the SDK's panel (400px wide, 600px tall). */}
        {isOpen && (
          <div className="relative z-10 w-[400px] max-w-[calc(100%-2rem)] h-[600px] max-h-[calc(100%-5rem)] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
            <iframe
              key={refreshKey}
              src={`/widget?theme=${theme}`}
              title="Widget preview"
              allow="clipboard-write"
              className="h-full w-full border-0"
            />
          </div>
        )}

        {/* Trigger button — mirrors the SDK launcher: icon-only circle, or an
            icon+label pill when the workspace sets a button label. */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'absolute bottom-4 flex items-center justify-center h-10 rounded-full',
            'bg-primary text-primary-foreground shadow-md',
            'transition-all hover:shadow-lg hover:-translate-y-0.5',
            label ? 'gap-1.5 ps-2.5 pe-3.5 text-xs font-semibold' : 'w-10',
            position === 'bottom-left' ? 'left-4' : 'right-4'
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
