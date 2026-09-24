import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { LogoUploader } from '@/components/admin/settings/logo-uploader'

export function WorkspaceIdentityCard(props: {
  workspaceName: string
  saving: boolean
  managed: boolean
  onWorkspaceNameChange: (value: string) => void
  maxLength?: number
}) {
  return (
    <SettingsCard
      title="Workspace"
      description="Your logo and name, shown across the portal, widget, and emails"
    >
      <div className="flex items-center gap-4">
        <LogoUploader workspaceName={props.workspaceName} />
        <div className="min-w-0 flex-1 max-w-md space-y-1.5">
          <Label htmlFor="workspace-name" className="text-xs text-muted-foreground">
            Workspace Name
          </Label>
          <div className="relative">
            <Input
              id="workspace-name"
              value={props.workspaceName}
              onChange={(e) => props.onWorkspaceNameChange(e.target.value)}
              placeholder="My Workspace"
              disabled={props.managed}
              maxLength={props.maxLength}
            />
            {props.saving && (
              <ArrowPathIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {props.managed && (
            <p className="text-xs text-muted-foreground">
              Managed by your administrator&apos;s config &mdash; edit there.
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
