import { Link, useRouteContext } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { SettingsCard } from '@/components/admin/settings/settings-card'
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
  const canAgent = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  const canWorkflows = usePermission(PERMISSIONS.WORKFLOW_MANAGE)
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const showWorkflows = canWorkflows && Boolean(flags?.supportInbox)

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: WHO_REPLIES_FIRST.titleId,
        defaultMessage: WHO_REPLIES_FIRST.title,
      })}
    >
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: WHO_REPLIES_FIRST.bodyId,
            defaultMessage: WHO_REPLIES_FIRST.body,
          })}{' '}
          {intl.formatMessage({
            id: WHO_REPLIES_FIRST.hoursId,
            defaultMessage: WHO_REPLIES_FIRST.hours,
          })}
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          {canAgent && (
            <Link
              to="/admin/automation/agent"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
            >
              {intl.formatMessage({
                id: 'automation.whoRepliesFirst.manageAgent',
                defaultMessage: 'Agent settings',
              })}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          )}
          {showWorkflows && (
            <Link
              to="/admin/automation/workflows"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
            >
              {intl.formatMessage({
                id: 'automation.whoRepliesFirst.manageWorkflows',
                defaultMessage: 'Workflows',
              })}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
