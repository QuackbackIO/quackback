/**
 * The widget, drawn in a design: the real widget app framed at its own size,
 * with the design posted in as the canvas posts it to the portal. It is a
 * picture to check the brand reaches the widget; the widget's own words and
 * buttons are set in Settings > Widget.
 */
import { useEffect, useRef, useState } from 'react'
import { usePreviewPosting } from '@/components/admin/settings/branding/use-preview-posting'
import type { PortalPreviewProps } from '@/components/admin/settings/branding/portal-preview'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'

/** The widget panel's size as a visitor's browser draws it. */
export const WIDGET_SIZE = { width: 400, height: 640 } as const

/** No structural draft: the widget takes the design alone. */
const NO_STRUCTURE: PortalPreviewDraft = {}

/** The address the widget is framed at: in the theme and language asked for, as a preview. */
export function widgetSampleSrc(theme: 'light' | 'dark', locale: string): string {
  return `/widget?${new URLSearchParams({ theme, locale, preview: 'true' })}`
}

/** The scale the widget is drawn at to fit a box, never larger than it is. */
export function widgetScale(box: { width: number; height: number }): number {
  if (box.width <= 0 || box.height <= 0) return 1
  return Math.min(1, box.width / WIDGET_SIZE.width, box.height / WIDGET_SIZE.height)
}

export function WidgetFrame({
  design,
  theme,
  locale,
  title,
}: {
  design: PortalPreviewProps['design']
  theme: 'light' | 'dark'
  locale: string
  /** What the frame is named, such as "Widget, live now". */
  title: string
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  usePreviewPosting(frame, {
    draftCss: '',
    cssDirty: false,
    draft: NO_STRUCTURE,
    draftDirty: false,
    design,
  })
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setScale(widgetScale(entry.contentRect)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={box} className="flex size-full min-h-0 items-center justify-center">
      <div
        className="shrink-0 overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        style={{
          width: WIDGET_SIZE.width * scale,
          height: WIDGET_SIZE.height * scale,
        }}
      >
        <iframe
          ref={frame}
          src={widgetSampleSrc(theme, locale)}
          title={title}
          className="origin-top-left border-0"
          style={{
            width: WIDGET_SIZE.width,
            height: WIDGET_SIZE.height,
            transform: scale < 1 ? `scale(${scale})` : undefined,
          }}
        />
      </div>
    </div>
  )
}
