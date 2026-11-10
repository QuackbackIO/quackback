import { useState } from 'react'
import { ClientOnly } from '@tanstack/react-router'
import type { PortalPreviewProps } from '@/components/admin/settings/branding/portal-preview'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { PAGE_NAMES } from '@/lib/shared/design/outline'
import { DesignerCanvas, NO_STRUCTURE } from './designer-canvas'
import { WidgetFrame } from './widget-sample'

const ignore = () => {}
/** The same empty structural draft every render, so neither frame posts it again. */

/**
 * The page as visitors see it now and as it will be once published, side by
 * side at desktop width, so a review shows what each change does. It opens on
 * the page being designed, and shows any other.
 */
export function ReviewCompare({
  page: start,
  pages,
  postPath = null,
  item = null,
  theme,
  locale,
  sort,
  live,
  draft,
}: {
  page: DesignerPage
  /** The pages it can show. */
  pages: readonly DesignerPage[]
  /** The post page's post. */
  postPath?: string | null
  /** The item the page being designed shows, such as an entry. */
  item?: string | null
  theme: 'light' | 'dark'
  locale: string
  sort: 'trending' | 'top' | 'new'
  live: PortalPreviewProps['design']
  draft: PortalPreviewProps['design']
}) {
  const [page, setPage] = useState(start)
  // The widget, which takes the brand too, in place of a page.
  const [widget, setWidget] = useState(false)
  const choice = (key: string, label: string, on: boolean, choose: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      onClick={choose}
      className={
        on
          ? 'rounded-md bg-muted px-2 py-1 text-xs font-medium'
          : 'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
      }
    >
      {label}
    </button>
  )
  const side = (label: string, design: PortalPreviewProps['design']) => (
    <figure className="m-0 flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
      {/* A picture to compare, not a page to use: it takes no focus or keys. */}
      <div className="h-[min(18rem,30dvh)]" inert>
        <ClientOnly>
          {widget ? (
            <WidgetFrame
              design={design}
              theme={theme}
              locale={locale}
              title={`Widget, ${label.toLowerCase()}`}
            />
          ) : (
            <DesignerCanvas
              page={page}
              name={label}
              postPath={page === start && item ? item : page === 'post' ? postPath : null}
              size="desktop"
              theme={theme}
              locale={locale}
              sort={sort}
              refreshKey={label}
              design={design}
              structural={NO_STRUCTURE}
              onSelect={ignore}
              onWords={ignore}
              onKey={ignore}
            />
          )}
        </ClientOnly>
      </div>
    </figure>
  )
  return (
    <section
      aria-label={`${widget ? 'Widget' : PAGE_NAMES[page]}, before and after`}
      className="space-y-2"
    >
      <div role="group" aria-label="Page" className="flex flex-wrap gap-1">
        {pages.map((each) =>
          choice(each, PAGE_NAMES[each], !widget && each === page, () => {
            setWidget(false)
            setPage(each)
          })
        )}
        {choice('widget', 'Widget', widget, () => setWidget(true))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {side('Live now', live)}
        {side('After you publish', draft)}
      </div>
    </section>
  )
}
