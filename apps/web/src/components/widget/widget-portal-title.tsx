import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { FormattedMessage } from 'react-intl'

interface WidgetPortalTitleProps {
  title: string
  onClick: () => void
}

/**
 * Clickable title that opens the item on the portal. The external-link icon
 * is always visible (faint, stronger on hover/focus): a hover-only reveal is
 * invisible on touch, and nothing else tells a visitor the heading is a link.
 */
export function WidgetPortalTitle({ title, onClick }: WidgetPortalTitleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left mt-0.5 block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {/* Hover cue is an underline, not text-primary: a light brand colour on
          the panel background would push the heading below text contrast. */}
      <h2 className="text-[15px] font-semibold text-foreground leading-snug inline decoration-muted-foreground/40 underline-offset-2 group-hover:underline">
        {title}
      </h2>
      <ArrowTopRightOnSquareIcon
        aria-hidden
        className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 group-focus-visible:text-muted-foreground/70 inline ml-1.5 mb-0.5 transition-colors duration-200"
      />
      <span className="sr-only">
        <FormattedMessage id="widget.portalTitle.openInPortal" defaultMessage="Open in portal" />
      </span>
    </button>
  )
}
