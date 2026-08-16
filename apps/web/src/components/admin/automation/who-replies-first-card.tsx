import type { ReactNode } from 'react'
import { Link, useRouteContext, useRouterState } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { WHO_REPLIES_FIRST } from '@/lib/shared/assistant/who-replies-first'
import type { FeatureFlags } from '@/lib/shared/types/settings'

/**
 * The rule the server now enforces: the agent answers first, and a live
 * assistant.handed_off workflow owns routing on handoff. Permission-aware
 * links so a workflows-only admin is not sent to Access denied.
 */
export function WhoRepliesFirstCard() {
  const intl = useIntl()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const canAgent = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  const canWorkflows = usePermission(PERMISSIONS.WORKFLOW_MANAGE)
  const canOfficeHours = usePermission(PERMISSIONS.OFFICE_HOURS_MANAGE)
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const onAgentPage = pathname === '/admin/automation/agent'
  const onWorkflowsPage =
    pathname === '/admin/automation/workflows' ||
    pathname.startsWith('/admin/automation/workflows/')
  const showManageQuinn = canAgent && !onAgentPage
  const showManageWorkflows = canWorkflows && Boolean(flags?.supportInbox) && !onWorkflowsPage
  const showOfficeHours = canOfficeHours && Boolean(flags?.supportInbox)

  const order = intl.formatMessage(
    onWorkflowsPage
      ? { id: WHO_REPLIES_FIRST.orderBelowId, defaultMessage: WHO_REPLIES_FIRST.orderBelow }
      : {
          id: WHO_REPLIES_FIRST.orderOnWorkflowsId,
          defaultMessage: WHO_REPLIES_FIRST.orderOnWorkflows,
        }
  )

  const rich = {
    b: (chunks: ReactNode) => <span className="font-semibold text-foreground">{chunks}</span>,
    order,
  }

  return (
    <section className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] px-[18px] py-3.5">
      <div className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
        <SparklesIcon className="size-[15px] text-violet-600 dark:text-violet-400" aria-hidden />
        {intl.formatMessage({
          id: WHO_REPLIES_FIRST.titleId,
          defaultMessage: WHO_REPLIES_FIRST.title,
        })}
      </div>
      <ol className="list-decimal space-y-0.5 pl-[18px] text-xs leading-[1.7] text-muted-foreground">
        {WHO_REPLIES_FIRST.steps.map((step) => (
          <li key={step.id}>
            {intl.formatMessage({ id: step.id, defaultMessage: step.defaultMessage }, rich)}
          </li>
        ))}
      </ol>
      {(showManageQuinn || showManageWorkflows || showOfficeHours) && (
        <div className="mt-2 flex flex-wrap gap-3.5 text-xs">
          {showManageQuinn && (
            <Link
              to="/admin/automation/agent"
              className="font-semibold text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {intl.formatMessage({
                id: 'automation.whoRepliesFirst.manageQuinn',
                defaultMessage: 'Manage Quinn',
              })}
            </Link>
          )}
          {showManageWorkflows && (
            <Link
              to="/admin/automation/workflows"
              className="font-semibold text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {intl.formatMessage({
                id: 'automation.whoRepliesFirst.manageWorkflows',
                defaultMessage: 'Manage workflows',
              })}
            </Link>
          )}
          {showOfficeHours && (
            <Link
              to="/admin/settings/office-hours"
              className="font-semibold text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {intl.formatMessage({
                id: 'automation.whoRepliesFirst.officeHoursLink',
                defaultMessage: 'Office hours',
              })}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
