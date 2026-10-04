import type { ReactNode } from 'react'
import { FormattedMessage } from 'react-intl'

/** The admin's one main region; pages inside it never open another. */
export const ADMIN_MAIN_ID = 'admin-main'

/** The admin shell: the sidebar beside an inset page sheet. */
export function AdminWorkspaceFrame({
  sidebar,
  notices,
  children,
}: {
  sidebar: ReactNode
  notices: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh bg-background">
      {/* First stop for keyboard users: past the rail, straight to the page. */}
      <a
        href={`#${ADMIN_MAIN_ID}`}
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-3 focus-visible:top-3 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-background focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-md focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
      >
        <FormattedMessage id="admin.skipToContent" defaultMessage="Skip to content" />
      </a>
      {sidebar}
      <main
        id={ADMIN_MAIN_ID}
        tabIndex={-1}
        data-admin-shell=""
        className="min-w-0 flex-1 overflow-hidden bg-chrome p-0 outline-none sm:h-dvh sm:py-2 sm:pe-2"
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
