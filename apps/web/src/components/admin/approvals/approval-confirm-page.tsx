import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { approvalKeys, approvalQueries } from '@/lib/client/queries/approvals'
import { Spinner } from '@/components/shared/spinner'
import { PageHeader } from '@/components/shared/page-header'
import { ApprovalDetail } from './approval-detail'
import { approvalMessages } from './approval-messages'

const route = getRouteApi('/admin/approvals_/confirm')

/** Opening the link reads only. Approve remains an explicit POST, bound to the emailed digest. */
export function ApprovalConfirmPage() {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [decidedId, setDecidedId] = useState<string | null>(null)
  const { id, d, source } = route.useSearch()
  const query = useQuery({ ...approvalQueries.detail(id ?? ''), enabled: !!id && !!d })
  const approval = query.data
  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader title={intl.formatMessage(approvalMessages.title)} />
      {!id || !d || query.isError ? (
        <p role="alert" className="p-6 text-sm text-muted-foreground">
          {intl.formatMessage(approvalMessages.notFound)}
        </p>
      ) : !approval ? (
        <div
          role="status"
          aria-label={intl.formatMessage(approvalMessages.loading)}
          className="p-6"
        >
          <Spinner />
        </div>
      ) : approval.contentHash !== d ? (
        <div className="p-6 text-sm">
          <p role="alert">{intl.formatMessage(approvalMessages.errorChanged)}</p>
          <Link to="/admin/approvals" search={{ id }} className="mt-3 inline-block underline">
            {intl.formatMessage(approvalMessages.back)}
          </Link>
        </div>
      ) : (
        <ApprovalDetail
          approval={approval}
          source={source}
          decidedHere={decidedId === approval.id}
          onChange={(next, decided) => {
            queryClient.setQueryData(approvalKeys.detail(next.id), next)
            if (decided) setDecidedId(next.id)
          }}
        />
      )}
    </div>
  )
}
