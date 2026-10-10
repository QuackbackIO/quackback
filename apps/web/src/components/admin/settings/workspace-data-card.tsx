import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'

/** Export lives on Imports & exports; this row points there. */
export function WorkspaceDataCard() {
  return (
    <SettingsCard title="Data">
      <SettingRows>
        <SettingRow
          label="Export workspace data"
          description="Downloads stay in this workspace. They never include platform keys."
          control={
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/settings/imports">
                <ArrowRightIcon className="size-4" />
                Imports &amp; exports
              </Link>
            </Button>
          }
        />
      </SettingRows>
    </SettingsCard>
  )
}
