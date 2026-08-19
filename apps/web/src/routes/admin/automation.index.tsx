'use client'

import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { AutomationNav } from '@/components/admin/automation/automation-nav'
import { PageHeader } from '@/components/shared/page-header'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/automation/')({
  component: AutomationIndexPage,
})

function AutomationIndexPage() {
  const navigate = useNavigate()
  const intl = useIntl()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const canManageAssistant = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  const canManageWorkflows = usePermission(PERMISSIONS.WORKFLOW_MANAGE)
  const canViewAnalytics = usePermission(PERMISSIONS.ANALYTICS_VIEW)
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined

  useEffect(() => {
    if (!isDesktop) return
    if (canManageAssistant) {
      navigate({ to: '/admin/automation/agent', replace: true })
    } else if (canManageWorkflows && flags?.supportInbox) {
      navigate({ to: '/admin/automation/workflows', replace: true })
    } else if (canViewAnalytics) {
      navigate({ to: '/admin/automation/performance', replace: true })
    }
  }, [
    canManageAssistant,
    canManageWorkflows,
    canViewAnalytics,
    flags?.supportInbox,
    isDesktop,
    navigate,
  ])

  return (
    <div className="lg:hidden">
      <PageHeader
        icon={SparklesIcon}
        title={intl.formatMessage({
          id: 'automation.nav.label',
          defaultMessage: 'AI & Automation',
        })}
        className="mb-6"
      />
      <AutomationNav />
    </div>
  )
}
