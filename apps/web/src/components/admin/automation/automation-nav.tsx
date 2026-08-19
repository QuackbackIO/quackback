import { Link, useRouteContext, useRouterState } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import {
  BeakerIcon,
  BoltIcon,
  ChartBarIcon,
  SparklesIcon,
  UserGroupIcon,
} from '@heroicons/react/24/solid'
import { MENU_ICON, MENU_LABEL, MENU_ROW } from '@/components/ui/menu'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'

interface NavItem {
  labelId: string
  defaultLabel: string
  to: string
  icon: typeof SparklesIcon
}

/**
 * A titled cluster of nav rows. The "Quinn AI" group holds the two peer agents
 * (Agent, Copilot); the trailing untitled group holds the standalone tools
 * (Workflows, Test, Performance) that sit beside Quinn rather than under it.
 */
interface NavSection {
  labelId?: string
  defaultLabel?: string
  items: NavItem[]
}

interface AutomationNavPermissions {
  assistant: boolean
  workflows: boolean
  analytics: boolean
}

export function buildAutomationNavSections(
  flags: { supportInbox?: boolean } | undefined,
  permissions: AutomationNavPermissions
): NavSection[] {
  const quinn: NavItem[] = permissions.assistant
    ? [
        {
          labelId: 'automation.nav.agent',
          defaultLabel: 'Agent',
          to: '/admin/automation/agent',
          icon: SparklesIcon,
        },
        {
          labelId: 'automation.nav.copilot',
          defaultLabel: 'Copilot',
          to: '/admin/automation/copilot',
          icon: UserGroupIcon,
        },
      ]
    : []

  const tools: NavItem[] = [
    permissions.workflows && flags?.supportInbox
      ? {
          labelId: 'automation.nav.workflows',
          defaultLabel: 'Workflows',
          to: '/admin/automation/workflows',
          icon: BoltIcon,
        }
      : null,
    permissions.assistant
      ? {
          labelId: 'automation.nav.test',
          defaultLabel: 'Test agent',
          to: '/admin/automation/test',
          icon: BeakerIcon,
        }
      : null,
    permissions.analytics
      ? {
          labelId: 'automation.nav.performance',
          defaultLabel: 'Performance',
          to: '/admin/automation/performance',
          icon: ChartBarIcon,
        }
      : null,
  ].filter((item): item is NavItem => item !== null)

  const sections: NavSection[] = []
  if (quinn.length > 0) {
    sections.push({
      labelId: 'automation.nav.group.quinn',
      defaultLabel: 'Quinn AI',
      items: quinn,
    })
  }
  if (tools.length > 0) sections.push({ items: tools })
  return sections
}

export function AutomationNav() {
  const intl = useIntl()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const permissions: AutomationNavPermissions = {
    assistant: usePermission(PERMISSIONS.ASSISTANT_MANAGE),
    workflows: usePermission(PERMISSIONS.WORKFLOW_MANAGE),
    analytics: usePermission(PERMISSIONS.ANALYTICS_VIEW),
  }
  const sections = buildAutomationNavSections(flags, permissions)

  return (
    <nav
      aria-label={intl.formatMessage({
        id: 'automation.nav.label',
        defaultMessage: 'AI & Automation',
      })}
      className="space-y-4"
    >
      {sections.map((section, index) => (
        <div key={section.labelId ?? `section-${index}`} className="space-y-1">
          {section.labelId && section.defaultLabel && (
            <p className={cn(MENU_LABEL, 'px-2 pb-1')}>
              {intl.formatMessage({ id: section.labelId, defaultMessage: section.defaultLabel })}
            </p>
          )}
          {section.items.map((item) => {
            const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`)
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  MENU_ROW,
                  'min-h-9',
                  isActive
                    ? 'bg-primary/10 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                )}
              >
                <Icon className={cn(MENU_ICON, isActive && 'text-primary')} />
                <span className="min-w-0 flex-1 truncate">
                  {intl.formatMessage({ id: item.labelId, defaultMessage: item.defaultLabel })}
                </span>
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
