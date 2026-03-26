import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'

interface WidgetPortalTitleProps {
  title: string
  onClick: () => void
}

/** Clickable title that links to the portal. Shows an external link icon on hover. */
export function WidgetPortalTitle({ title, onClick }: WidgetPortalTitleProps) {
  return (
    <button type="button" onClick={onClick} className="group text-left mt-0.5 block">
      <h2 className="text-[15px] font-semibold text-foreground leading-snug group-hover:text-primary transition-colors inline">
        {title}
      </h2>
      <ArrowTopRightOnSquareIcon className="h-4 w-4 text-muted-foreground/40 inline ml-1.5 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
    </button>
  )
}
