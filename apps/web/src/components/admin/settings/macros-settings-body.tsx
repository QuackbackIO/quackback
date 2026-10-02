import { SettingsCard } from '@/components/admin/settings/settings-card'
import { MacrosManager } from '@/components/admin/conversation/macros-manager'
import { UpgradeScreen } from '@/components/admin/upgrade'

export function MacrosSettingsBody({
  entitled,
  creating,
  onCreatingChange,
}: {
  entitled: boolean
  creating: boolean
  onCreatingChange: (creating: boolean) => void
}) {
  return entitled ? (
    <SettingsCard flush>
      <MacrosManager creating={creating} onCreatingChange={onCreatingChange} />
    </SettingsCard>
  ) : (
    <UpgradeScreen entitlement="aiDrafts" />
  )
}
