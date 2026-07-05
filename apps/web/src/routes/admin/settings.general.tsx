import { useState, useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Cog6ToothIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { updateWorkspaceNameFn } from '@/lib/server/functions/settings'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '@/lib/client/config-file'

export const Route = createFileRoute('/admin/settings/general')({
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    return {}
  },
  component: GeneralSettingsPage,
})

/**
 * Workspace identity and defaults. Deliberately small today: the workspace
 * name lives here (moved from Branding); workspace-wide defaults (timezone,
 * language) and module toggles join once they have real consumers
 * (SETTINGS-IA-SPEC, Workspace > General).
 */
function GeneralSettingsPage() {
  const { settings, managedFieldPaths } = Route.useRouteContext()
  const workspaceNameManaged = isPathManagedFromBootstrap(
    MANAGED_PATHS.WORKSPACE_NAME,
    managedFieldPaths ?? []
  )

  const [workspaceName, setWorkspaceName] = useState(settings?.name || '')
  const [isSavingName, setIsSavingName] = useState(false)
  const nameTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Timer cleanup on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (nameTimeoutRef.current) clearTimeout(nameTimeoutRef.current)
    }
  }, [])

  // Debounced workspace name save
  const handleNameChange = (value: string) => {
    setWorkspaceName(value)
    if (nameTimeoutRef.current) {
      clearTimeout(nameTimeoutRef.current)
    }
    nameTimeoutRef.current = setTimeout(async () => {
      if (value.trim() && value !== settings?.name) {
        setIsSavingName(true)
        try {
          await updateWorkspaceNameFn({ data: { name: value.trim() } })
        } catch {
          toast.error('Failed to update workspace name')
        } finally {
          setIsSavingName(false)
        }
      }
    }, 800)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={Cog6ToothIcon}
        title="General"
        description="Workspace identity and defaults"
      />

      <SettingsCard title="Workspace" description="The name shown across the portal and emails">
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="workspace-name" className="text-xs text-muted-foreground">
            Workspace Name
          </Label>
          <div className="relative">
            <Input
              id="workspace-name"
              value={workspaceName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My Workspace"
              disabled={workspaceNameManaged}
            />
            {isSavingName && (
              <ArrowPathIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {workspaceNameManaged && (
            <p className="text-xs text-muted-foreground">
              Managed by your administrator&apos;s config &mdash; edit there.
            </p>
          )}
        </div>
      </SettingsCard>
    </div>
  )
}
