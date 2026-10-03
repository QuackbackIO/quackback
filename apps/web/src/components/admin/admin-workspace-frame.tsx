import type { ReactNode } from 'react'

/**
 * The admin shell: the sidebar beside an inset page sheet. A full-screen view
 * (a started Home chat) drops the sidebar, notices and the inset.
 */
export function AdminWorkspaceFrame({
  focused,
  sidebar,
  notices,
  children,
}: {
  focused: boolean
  sidebar: ReactNode
  notices: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh bg-background">
      {!focused && sidebar}
      <main
        data-admin-shell=""
        className="min-w-0 flex-1 overflow-hidden bg-chrome p-0 sm:h-dvh sm:py-2 sm:pe-2 sm:data-[copilot-focused]:py-0 sm:data-[copilot-focused]:pe-0"
        data-copilot-focused={focused || undefined}
      >
        <div
          data-admin-canvas=""
          className="flex h-full flex-col overflow-hidden bg-background pt-14 text-foreground sm:rounded-[14px] sm:border sm:border-chrome-hairline sm:pt-0 sm:shadow-chrome-canvas in-data-[copilot-focused]:pt-0 sm:in-data-[copilot-focused]:rounded-none sm:in-data-[copilot-focused]:border-0 sm:in-data-[copilot-focused]:shadow-none"
        >
          {!focused && notices}
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </main>
    </div>
  )
}
