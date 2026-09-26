import { IntegrationList } from '@/components/admin/settings/integrations/integration-list'
import { UpgradeScreen } from '@/components/admin/upgrade'
import { describePlanUpgrade } from '@/lib/shared/describe-upgrade'

export function IntegrationsSettingsBody(props: {
  enabled: boolean
  catalog: Parameters<typeof IntegrationList>[0]['catalog']
  integrations: Parameters<typeof IntegrationList>[0]['integrations']
}) {
  return props.enabled ? (
    <IntegrationList catalog={props.catalog} integrations={props.integrations} />
  ) : (
    <UpgradeScreen
      description={describePlanUpgrade('Integrations', 'business', { plural: true })}
    />
  )
}
