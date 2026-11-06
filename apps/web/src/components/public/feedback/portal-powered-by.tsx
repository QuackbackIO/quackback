import { FormattedMessage } from 'react-intl'

/** The "Powered by Quackback" badge under the portal's filter panel. */
export function PortalPoweredBy({ workspaceSlug }: { workspaceSlug?: string }) {
  return (
    <div className="flex justify-center">
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
  )
}
