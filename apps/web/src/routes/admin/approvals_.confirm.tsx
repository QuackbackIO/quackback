import { createFileRoute } from '@tanstack/react-router'
import { isValidTypeId } from '@quackback/ids'
import { adminPageHead } from '@/lib/client/admin-head'
import { ApprovalConfirmPage } from '@/components/admin/approvals/approval-confirm-page'

export const Route = createFileRoute('/admin/approvals_/confirm')({
  head: adminPageHead('Approvals'),
  validateSearch: (search: Record<string, unknown>) => ({
    id:
      typeof search.id === 'string' && isValidTypeId(search.id, 'assistant_action')
        ? search.id
        : undefined,
    source: search.source === 'email' ? ('email' as const) : ('app' as const),
    d: typeof search.d === 'string' && /^[a-f0-9]{64}$/.test(search.d) ? search.d : undefined,
  }),
  component: ApprovalConfirmPage,
})
