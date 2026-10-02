import type { ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { WHO_REPLIES_FIRST } from '@/lib/shared/assistant/who-replies-first'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'

/**
 * The rule the server enforces: the agent answers first, and a live
 * assistant.handed_off workflow owns routing on handoff. Permission-aware
 * links so a workflows-only admin is not sent to Access denied.
 */
export function WhoRepliesFirstCard() {
  const intl = useIntl()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const canAgent = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  const canWorkflows = usePermission(PERMISSIONS.WORKFLOW_MANAGE)
  const canOfficeHours = usePermission(PERMISSIONS.OFFICE_HOURS_MANAGE)
  const settings = useWorkspaceSettings()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const onAgentPage = pathname === '/admin/settings/agent'
  const onWorkflowsPage =
    pathname === '/admin/settings/workflows' || pathname.startsWith('/admin/settings/workflows/')
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
    <SettingsCard
      title={intl.formatMessage({
        id: WHO_REPLIES_FIRST.titleId,
        defaultMessage: WHO_REPLIES_FIRST.title,
      })}
    >
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
              to="/admin/settings/agent"
              className={`${INLINE_LINK} focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
            >
              {intl.formatMessage({
                id: 'automation.whoRepliesFirst.manageQuinn',
                defaultMessage: 'Manage Quinn',
              })}
            </Link>
          )}
          {showManageWorkflows && (
            <Link
              to="/admin/settings/workflows"
              className={`${INLINE_LINK} focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
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
              className={`${INLINE_LINK} focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
            >
              {intl.formatMessage({
                id: 'automation.whoRepliesFirst.officeHoursLink',
                defaultMessage: 'Office hours',
              })}
            </Link>
          )}
        </div>
      )}
    </SettingsCard>
  )
}
