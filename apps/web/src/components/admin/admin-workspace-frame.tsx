import type { ReactNode } from 'react'

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
      {sidebar}
      <main
        data-admin-shell=""
        className="min-w-0 flex-1 overflow-hidden bg-chrome p-0 sm:h-dvh sm:py-2 sm:pe-2"
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
