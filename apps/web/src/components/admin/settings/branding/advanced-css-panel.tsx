import { lazy, Suspense, useState } from 'react'
import { ChevronDownIcon } from '@heroicons/react/24/solid'

// @uiw/react-codemirror + @codemirror/lang-css make this the largest route
// chunk in the app, yet most visits never open the "Advanced CSS" panel, so
// it is its own chunk, fetched when the pointer or focus reaches the panel's
// summary and rendered once the panel first opens.
const loadCustomCssEditor = () => import('@/components/admin/settings/branding/custom-css-editor')

const CustomCssEditor = lazy(() =>
  loadCustomCssEditor().then((m) => ({ default: m.CustomCssEditor }))
)

// Fixed-height skeleton matching the editor's rendered height (280px) plus
// its border, so the Advanced CSS panel doesn't jump while the chunk loads.
function CustomCssEditorFallback() {
  return (
    <div
      className="h-[280px] animate-pulse rounded-md border border-input bg-muted/30"
      aria-hidden="true"
    />
  )
}

/**
 * The portal theme's raw stylesheet, behind a collapsed "Advanced CSS"
 * disclosure. A closed <details> still renders its children, so the editor is
 * held back until the panel has been opened once, then kept mounted so closing
 * and reopening keeps the editor's state.
 */
export function AdvancedCssPanel({
  value,
  onChange,
}: {
  value: string
  onChange: (css: string) => void
}) {
  const [opened, setOpened] = useState(false)
  const preload = () => void loadCustomCssEditor()

  return (
    <details
      className="group rounded-lg border border-border/60 bg-muted/30"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true)
      }}
    >
      <summary
        onPointerEnter={preload}
        onFocus={preload}
        className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-muted-foreground group-open:text-foreground [&::-webkit-details-marker]:hidden"
      >
        Advanced CSS
        <span className="ms-auto flex items-center gap-3">
          <a
            href="https://tweakcn.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Design at tweakcn.com
          </a>
          <ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="px-3 pb-3">
        {opened ? (
          <Suspense fallback={<CustomCssEditorFallback />}>
            <CustomCssEditor value={value} onChange={onChange} />
          </Suspense>
        ) : (
          <CustomCssEditorFallback />
        )}
      </div>
    </details>
  )
}
