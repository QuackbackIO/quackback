import type { ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'

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
        data-copilot-focused={focused || undefined}
        className={cn(
          'min-w-0 flex-1 overflow-hidden bg-chrome p-0',
          !focused && 'sm:h-dvh sm:py-2 sm:pe-2'
        )}
      >
        <div
          data-admin-canvas=""
          className={cn(
            'flex h-full flex-col overflow-hidden bg-background text-foreground',
            !focused &&
              'pt-14 sm:rounded-[14px] sm:border sm:border-chrome-hairline sm:pt-0 sm:shadow-chrome-canvas'
          )}
        >
          {!focused && notices}
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </main>
    </div>
  )
}
