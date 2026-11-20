import { FormattedMessage } from 'react-intl'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'

/**
 * A small "via API" mark beside the author name, for a message an API key
 * wrote under its own name (a workspace key, or a personal key that keeps the
 * key's name). The server sets `viaApi` on team views only.
 */
export function ViaApiBadge({
  author,
}: {
  author: Pick<ConversationAuthorDTO, 'viaApi'> | null | undefined
}) {
  if (!author?.viaApi) return null
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <FormattedMessage id="admin.inbox.message.viaApi" defaultMessage="via API" />
    </span>
  )
}
