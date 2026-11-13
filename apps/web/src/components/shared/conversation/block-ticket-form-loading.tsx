/**
 * The loading row of the ticket form block. Kept apart from the form itself so
 * the conversation thread can show it while the form's own chunk loads, and the
 * form shows the same row while its ticket types load.
 */
import { FormattedMessage } from 'react-intl'
import { Spinner } from '@/components/shared/spinner'

export function BlockTicketFormLoadingRow() {
  return (
    <div role="status" className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <Spinner size="sm" />
      <FormattedMessage id="widget.loading" defaultMessage="Loading…" />
    </div>
  )
}

/** The block's card frame around the loading row (the form's chunk loading). */
export function BlockTicketFormLoading() {
  return (
    <div className="mt-1.5 w-full max-w-sm rounded-xl border border-border bg-background p-3 shadow-xs">
      <BlockTicketFormLoadingRow />
    </div>
  )
}
