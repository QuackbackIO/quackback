import { createFileRoute, redirect } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { OfficeHoursSettings } from '@/components/admin/settings/hours/office-hours-settings'
import { SlaSettings } from '@/components/admin/settings/hours/sla-settings'
import {
  officeHoursQuery,
  slaPoliciesQuery,
  slaOfficeHoursQuery,
} from '@/lib/client/queries/hours-sla'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsSection } from '@/components/admin/settings/settings-section'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { settingsQueries } from '@/lib/client/queries/settings'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/hours-sla')({
  head: adminPageHead('Hours and SLA settings'),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
    assertRouteAnyPermission(context.permissions, [
      PERMISSIONS.OFFICE_HOURS_MANAGE,
      PERMISSIONS.SLA_MANAGE,
    ])
  },
  loader: async ({ context }) => {
    const held = new Set<string>(context.permissions ?? [])
    const { queryClient } = context
    await Promise.all([
      held.has(PERMISSIONS.OFFICE_HOURS_MANAGE)
        ? queryClient.ensureQueryData(officeHoursQuery)
        : undefined,
      held.has(PERMISSIONS.SLA_MANAGE)
        ? Promise.all([
            queryClient.ensureQueryData(slaPoliciesQuery),
            queryClient.ensureQueryData(settingsQueries.defaultSlaPolicy()),
            // The policies' office-hours note reads these on first paint.
            warmQuery(queryClient, slaOfficeHoursQuery),
          ])
        : undefined,
    ])
    return {}
  },
  component: HoursAndSlasPage,
})

function HoursAndSlasPage() {
  const intl = useIntl()
  const canHours = usePermission(PERMISSIONS.OFFICE_HOURS_MANAGE)
  const canSla = usePermission(PERMISSIONS.SLA_MANAGE)
  return (
    <SettingsPage page="/admin/settings/hours-sla" width="wide">
      {canHours && (
        <SettingsSection
          title={intl.formatMessage({
            id: 'settings.hoursSla.officeHours',
            defaultMessage: 'Office hours',
          })}
        >
          <OfficeHoursSettings />
        </SettingsSection>
      )}
      {canSla && (
        <SettingsSection
          title={intl.formatMessage({
            id: 'settings.hoursSla.sla',
            defaultMessage: 'SLA policies',
          })}
        >
          <SlaSettings />
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
