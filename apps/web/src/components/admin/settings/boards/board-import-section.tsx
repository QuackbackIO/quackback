import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'

// boardId is unused for now: the hub's uploader doesn't yet accept a
// preselected board via URL. Kept on the props contract so the wizard can
// wire it through without touching this call site again.
interface BoardImportSectionProps {
  boardId: string
}

/** Deep link into the Imports & exports hub, where imports run. */
export function BoardImportSection(_props: BoardImportSectionProps) {
  return (
    <SettingRows>
      <SettingRow
        label="Import posts"
        description="Bring posts into this board from a CSV file."
        control={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/settings/imports">Go to Imports &amp; exports</Link>
          </Button>
        }
      />
    </SettingRows>
  )
}
