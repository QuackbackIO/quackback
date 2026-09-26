import { SettingsCard } from '@/components/admin/settings/settings-card'
import { MacrosManager } from '@/components/admin/conversation/macros-manager'
import { UpgradeScreen } from '@/components/admin/upgrade'

export function MacrosSettingsBody({ entitled }: { entitled: boolean }) {
  return entitled ? (
    <SettingsCard>
      <MacrosManager />
    </SettingsCard>
  ) : (
    <UpgradeScreen entitlement="aiDrafts" />
  )
}
