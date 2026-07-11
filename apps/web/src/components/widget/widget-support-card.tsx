import { FormattedMessage } from 'react-intl'
import { LifebuoyIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import type { WidgetSupportCategory } from '@/lib/client/widget/tickets-api'

interface WidgetSupportCardProps {
  onOpen: () => void
  categories?: WidgetSupportCategory[]
}

export function WidgetSupportCard({ onOpen, categories = [] }: WidgetSupportCardProps) {
  const firstCategory = categories.length === 1 ? categories[0] : null
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors px-3 py-2.5 flex items-center gap-2.5"
    >
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
        <LifebuoyIcon className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground text-sm leading-tight">
          {firstCategory?.label ?? (
            <FormattedMessage id="widget.support.card.title" defaultMessage="Contact support" />
          )}
        </p>
        <p className="text-[11px] text-muted-foreground/80 line-clamp-1">
          {firstCategory?.description ??
            (categories.length > 1 ? (
              <FormattedMessage
                id="widget.support.card.categoriesDescription"
                defaultMessage="Choose the right support category."
              />
            ) : (
              <FormattedMessage
                id="widget.support.card.description"
                defaultMessage="Get help directly from our team."
              />
            ))}
        </p>
      </div>
      <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
    </button>
  )
}
