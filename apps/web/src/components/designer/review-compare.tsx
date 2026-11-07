import { useState } from 'react'
import { ClientOnly } from '@tanstack/react-router'
import type { PortalPreviewProps } from '@/components/admin/settings/branding/portal-preview'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { PAGE_NAMES } from '@/lib/shared/design/outline'
import { DesignerCanvas } from './designer-canvas'

const ignore = () => {}
/** The same empty structural draft every render, so neither frame posts it again. */
const NO_STRUCTURE = {}

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
  const side = (label: string, design: PortalPreviewProps['design']) => (
    <figure className="m-0 flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
      {/* A picture to compare, not a page to use: it takes no focus or keys. */}
      <div className="h-[min(18rem,30dvh)]" inert>
        <ClientOnly>
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
        </ClientOnly>
      </div>
    </figure>
  )
  return (
    <section aria-label={`${PAGE_NAMES[page]}, before and after`} className="space-y-2">
      {pages.length > 1 && (
        <div role="group" aria-label="Page" className="flex flex-wrap gap-1">
          {pages.map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={each === page}
              onClick={() => setPage(each)}
              className={
                each === page
                  ? 'rounded-md bg-muted px-2 py-1 text-xs font-medium'
                  : 'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
              }
            >
              {PAGE_NAMES[each]}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {side('Live now', live)}
        {side('After you publish', draft)}
      </div>
    </section>
  )
}
