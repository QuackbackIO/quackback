import { Suspense, useEffect, useRef, useState } from 'react'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { Button, NewTabHint } from '@/components/ui/button'
import { lazyWithPreload } from '@/lib/client/lazy-with-preload'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'

// CodeMirror is the largest chunk in the admin; it loads when the drawer is
// about to open, never with the page.
const { Component: CustomCssEditor, preload } = lazyWithPreload(
  () => import('@/components/admin/settings/branding/custom-css-editor'),
  'CustomCssEditor'
)

/** The closed section's value. */
export function advancedCssSummary(remainder: string, parked: boolean): string {
  if (!remainder) return 'Theme only'
  return parked ? 'Own rules · not live' : 'Own rules'
}

/** The section: what Advanced CSS is, the drawer, and a way back to the default theme. */
export function AdvancedCssSection({
  onOpenEditor,
  onReset,
}: {
  onOpenEditor: () => void
  onReset: () => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        The whole theme as CSS. Theme colours can be edited here on any plan. Your own rules, like a
        gradient header, need the Business plan.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Links and counts use <code>--primary-ink</code>, a shade of the main colour kept readable.
        Setting it yourself overrides that.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onPointerEnter={preload}
          onFocus={preload}
          onClick={onOpenEditor}
        >
          Open the CSS editor
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset to the default theme
        </Button>
      </div>
    </div>
  )
}

/** How long typing rests before the preview takes the stylesheet. */
const PREVIEW_DEBOUNCE_MS = 250

/**
 * The CSS editor, in a drawer over the preview's left edge: the preview
 * stays visible beside it and re-fits.
 */
export function AdvancedCssDrawer({
  value,
  ownRules,
  onChange,
  onClose,
}: {
  value: string
  /** Rules outside the theme (:root and .dark) exist: they need the Business plan. */
  ownRules: boolean
  onChange: (css: string) => void
  onClose: () => void
}) {
  // Typing goes to the editor at once and to the draft (and the preview) once it rests.
  const [text, setText] = useState(value)
  const pushed = useRef(value)
  useEffect(() => {
    if (value !== pushed.current) {
      pushed.current = value
      setText(value)
    }
  }, [value])
  useEffect(() => {
    if (text === pushed.current) return
    const timer = window.setTimeout(() => {
      pushed.current = text
      onChange(text)
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text, onChange])

  return (
    <aside
      aria-label="CSS editor"
      className="flex h-full w-[440px] shrink-0 flex-col border-e border-border bg-background"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-[13px] font-medium">Advanced CSS</span>
        <a
          href="https://tweakcn.com"
          target="_blank"
          rel="noopener noreferrer"
          className={`${INLINE_LINK} ms-auto text-xs`}
        >
          Design at tweakcn.com
          <NewTabHint />
        </a>
        <Button variant="ghost" size="icon-sm" aria-label="Close the CSS editor" onClick={onClose}>
          <XMarkIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {ownRules ? (
        <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Rules outside :root and .dark are your own CSS, which needs the Business plan to go live.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 p-3">
        <Suspense
          fallback={<div className="h-full animate-pulse rounded-md bg-muted/30" aria-hidden />}
        >
          <CustomCssEditor value={text} onChange={setText} height="100%" />
        </Suspense>
      </div>
    </aside>
  )
}
