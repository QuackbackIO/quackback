import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'

/** The admin's one main region; pages inside it never open another. */
export const ADMIN_MAIN_ID = 'admin-main'

/** The sidebar's width (its own w-56), which its slot animates to and from. */
const SIDEBAR_PX = 224

/**
 * The admin shell: the sidebar beside an inset page sheet. A full-page route
 * (portal Customise) folds the sidebar away, `collapsed`, and the sheet keeps
 * an even margin on every side; both changes are animated. The phone top bar
 * the sidebar renders stays either way.
 */
export function AdminWorkspaceFrame({
  sidebar,
  notices,
  collapsed = false,
  children,
}: {
  sidebar: ReactNode
  notices: ReactNode
  collapsed?: boolean
  children: ReactNode
}) {
  // Formatted in place: a message component would render once more on every page.
  const intl = useIntl()
  return (
    <div className="flex h-dvh bg-background">
      {/* First stop for keyboard users: past the rail, straight to the page. */}
      <a
        href={`#${ADMIN_MAIN_ID}`}
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-3 focus-visible:top-3 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-background focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-md focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
      >
        {intl.formatMessage({ id: 'admin.skipToContent', defaultMessage: 'Skip to content' })}
      </a>
      {/* Below sm the slot steps aside (display: contents): the rail hides
          itself there, and the sidebar's phone top bar, a fixed header with
          the menu, must stay on screen on every admin page. From sm up a
          folded slot is invisible, so the rail leaves the tab order and the
          accessibility tree once the width transition ends. */}
      {sidebar ? (
        <div
          data-admin-sidebar-slot=""
          style={{ width: collapsed ? 0 : SIDEBAR_PX }}
          className={cn(
            'contents shrink-0 overflow-hidden transition-[width,visibility] duration-300 ease-out motion-reduce:transition-none sm:flex',
            collapsed && 'sm:invisible'
          )}
        >
          {sidebar}
        </div>
      ) : null}
      <main
        id={ADMIN_MAIN_ID}
        tabIndex={-1}
        data-admin-shell=""
        className={cn(
          'min-w-0 flex-1 overflow-hidden bg-chrome p-0 outline-none transition-[padding] duration-300 ease-out motion-reduce:transition-none sm:h-dvh sm:py-2 sm:pe-2',
          collapsed ? 'sm:ps-2' : 'sm:ps-0'
        )}
      >
        <div
          data-admin-canvas=""
          className="flex h-full flex-col overflow-hidden bg-background pt-14 text-foreground sm:rounded-[14px] sm:border sm:border-chrome-hairline sm:pt-0 sm:shadow-chrome-canvas"
        >
          {notices}
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </main>
    </div>
  )
}
