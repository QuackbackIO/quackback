import { useMemo, useState } from 'react'
import { ClientOnly } from '@tanstack/react-router'
import type { PortalPreviewProps } from '@/components/admin/settings/branding/portal-preview'
import { onRadioKeys } from '@/components/admin/settings/appearance/radio-keys'
import { pagesChanged, type SpotChange } from '@/lib/shared/design/change-spots'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { PAGE_NAMES } from '@/lib/shared/design/outline'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { useViewportWidth } from './ai-pane'
import { CanvasSkeleton } from './canvas-skeleton'
import { DesignerCanvas, NO_STRUCTURE } from './designer-canvas'
import { WidgetFrame } from './widget-sample'

const ignore = () => {}
/** What the After frame shows until it has drawn the draft. */
const AFTER_SKELETON = (
  <CanvasSkeleton
    parts={[
      { key: 'header', kind: 'header' },
      { key: 'hero', kind: 'hero' },
      { key: 'part', kind: 'part' },
    ]}
  />
)

/**
 * Below this window width the two frames take turns, so each is drawn large
 * enough to read. (The builder's own width hook and radio keys: a shared
 * control or media-query hook would add their chunks to the builder's open.)
 */
export const SIDE_BY_SIDE_WIDTH = 960

type View = 'side' | 'live' | 'after'
const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'side', label: 'Side by side' },
  { value: 'live', label: 'Live now' },
  { value: 'after', label: 'After you publish' },
]
const TURNS = VIEWS.slice(1)

/**
 * The page it opens on: the page being designed when the draft changes it,
 * else the first page the draft changes, else the page being designed.
 */
export function openingPage(
  start: DesignerPage,
  pages: readonly DesignerPage[],
  changed: ReadonlySet<DesignerPage>
): DesignerPage {
  if (changed.has(start)) return start
  return pages.find((page) => changed.has(page)) ?? start
}

/**
 * The page as visitors see it now and as it will be once published, side by
 * side at desktop width, or one at a time where the window is narrow, so a
 * review shows what each change does. Each page the draft changes is marked;
 * it opens on the page being designed if that changed, else the first that did.
 *
 * Both frames load once and go to another page in place, so switching pages
 * loads no new document. The After frame's page is drawn by the server with
 * the saved draft, so it shows the draft from its first paint.
 */
export function ReviewCompare({
  page: designing,
  pages,
  postPath = null,
  item = null,
  theme,
  locale,
  sort,
  live,
  draft,
  changes = [],
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
  /** The draft's changes, which say which pages it changes. */
  changes?: readonly SpotChange[]
}) {
  const changed = useMemo(
    () =>
      draft
        ? pagesChanged(draft as PortalDesign, changes, pages)
        : { pages: new Set(pages), widget: true },
    [draft, changes, pages]
  )
  const [page, setPage] = useState(() => openingPage(designing, pages, changed.pages))
  // The widget, which takes the brand too, in place of a page; its frames load when first shown.
  const [widget, setWidget] = useState(false)
  const [widgetSeen, setWidgetSeen] = useState(false)
  const wide = useViewportWidth() >= SIDE_BY_SIDE_WIDTH
  const [chosen, setChosen] = useState<View>('side')
  // Side by side only where both fit at a size to read; else the draft first.
  const view: View = !wide && chosen === 'side' ? 'after' : chosen
  const differs = widget ? changed.widget : changed.pages.has(page)

  const choice = (key: string, label: string, on: boolean, mark: boolean, choose: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      // A page the draft changes says so, as its dot shows it.
      aria-label={mark ? `${label}, changed` : undefined}
      onClick={choose}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs outline-none focus-ring',
        on
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {label}
      {mark && (
        <span
          aria-hidden="true"
          data-changed-dot=""
          className="size-1.5 rounded-full bg-foreground/70"
        />
      )}
    </button>
  )

  const side = (which: 'live' | 'after') => {
    const label = which === 'live' ? 'Live now' : 'After you publish'
    const design = which === 'live' ? live : draft
    return (
      <figure
        key={which}
        data-side={which}
        className={cn(
          'm-0 flex min-w-0 flex-col gap-1.5',
          view !== 'side' && view !== which && 'hidden'
        )}
      >
        <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
        {/* A picture to compare, not a page to use: it takes no focus or keys. */}
        <div className="h-[min(36rem,max(16rem,calc(100dvh-22rem)))]" inert>
          <ClientOnly>
            {/* The pages stay loaded while the widget shows, so going back loads nothing. */}
            <div className={cn('size-full', widget && 'hidden')}>
              <DesignerCanvas
                page={page}
                name={label}
                postPath={page === designing && item ? item : page === 'post' ? postPath : null}
                size="desktop"
                theme={theme}
                locale={locale}
                sort={sort}
                refreshKey={label}
                design={design}
                structural={NO_STRUCTURE}
                inPlace
                still
                // After publishing: drawn by the server with the draft, and a skeleton until it is.
                {...(which === 'after'
                  ? { draft: true, untilDrawn: true, skeleton: AFTER_SKELETON }
                  : {})}
                onSelect={ignore}
                onWords={ignore}
                onKey={ignore}
              />
            </div>
            {widgetSeen && (
              <div className={cn('size-full', !widget && 'hidden')}>
                <WidgetFrame
                  design={design}
                  theme={theme}
                  locale={locale}
                  title={`Widget, ${label.toLowerCase()}`}
                />
              </div>
            )}
          </ClientOnly>
        </div>
      </figure>
    )
  }

  return (
    <section
      aria-label={`${widget ? 'Widget' : PAGE_NAMES[page]}, before and after`}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Page" className="flex flex-wrap gap-1">
          {pages.map((each) =>
            choice(
              each,
              PAGE_NAMES[each],
              !widget && each === page,
              changed.pages.has(each),
              () => {
                setWidget(false)
                setPage(each)
              }
            )
          )}
          {choice('widget', 'Widget', widget, changed.widget, () => {
            setWidget(true)
            setWidgetSeen(true)
          })}
        </div>
        <div
          role="radiogroup"
          aria-label="Show"
          onKeyDown={onRadioKeys}
          className="flex rounded-lg bg-muted p-0.5"
        >
          {(wide ? VIEWS : TURNS).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={view === value}
              tabIndex={view === value ? 0 : -1}
              onClick={() => setChosen(value)}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-ring',
                view === value &&
                  'bg-background font-medium text-foreground shadow-sm forced-colors:outline forced-colors:outline-1'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!differs && (
        <p className="text-xs text-muted-foreground" data-no-change="">
          No visible change on this page.
        </p>
      )}
      <div className={cn('grid gap-4', view === 'side' && 'grid-cols-2')}>
        {side('live')}
        {side('after')}
      </div>
    </section>
  )
}
