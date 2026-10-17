import { FormattedMessage } from 'react-intl'

interface FeedbackSidebarProps {
  /** The filter panel. */
  children: React.ReactNode
  workspaceSlug?: string
  showPoweredBy?: boolean
}

export function FeedbackSidebar({
  children,
  workspaceSlug,
  showPoweredBy = true,
}: FeedbackSidebarProps) {
  return (
    <aside className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin">
        {children}

        {showPoweredBy ? (
          <div className="flex justify-center mt-3">
            <a
              href={`https://quackback.io?utm_campaign=${encodeURIComponent(workspaceSlug || 'unknown')}&utm_content=feedback-board&utm_medium=referral&utm_source=powered-by`}
              target="_blank"
              className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-all px-2.5 py-1 rounded-full bg-muted/50 hover:bg-muted border border-transparent hover:border-border/50"
            >
              <img
                src="/logo.png"
                alt=""
                width={14}
                height={14}
                className="-mt-px opacity-60 group-hover:opacity-100 transition-opacity"
              />
              <span>
                <FormattedMessage
                  id="portal.feedback.sidebar.poweredBy"
                  defaultMessage="Powered by {brand}"
                  values={{
                    brand: <span className="font-semibold">Quackback</span>,
                  }}
                />
              </span>
            </a>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
