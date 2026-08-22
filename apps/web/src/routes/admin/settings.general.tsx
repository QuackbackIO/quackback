import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Cog6ToothIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { LogoUploader } from '@/components/admin/settings/logo-uploader'
import { updateWorkspaceNameFn } from '@/lib/server/functions/settings'
import { getCloudIdentityFn, updateCloudIdentityFn } from '@/lib/server/functions/cloud-identity'
import { updateFeatureFlagsFn } from '@/lib/server/functions/feature-flags'
import { useDebouncedSave } from '@/lib/client/hooks/use-debounced-save'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '@/lib/client/config-file'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  DEFAULT_FEATURE_FLAGS,
  PRODUCT_DEFINITIONS,
  getProductFlagUpdate,
  isProductEnabled,
  type FeatureFlags,
  type ProductId,
} from '@/lib/shared/types'
import { Switch } from '@/components/ui/switch'
import { WorkspaceDangerCard } from '@/components/admin/settings/workspace-danger-card'

export const Route = createFileRoute('/admin/settings/general')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const [cloudIdentity] = await Promise.all([
      getCloudIdentityFn(),
      context.queryClient.ensureQueryData(settingsQueries.logo()),
    ])
    return { cloudIdentity }
  },
  component: GeneralSettingsPage,
})

function GeneralSettingsPage() {
  const { settings, managedFieldPaths } = Route.useRouteContext()
  const { cloudIdentity } = Route.useLoaderData()
  const workspaceNameManaged = isPathManagedFromBootstrap(
    MANAGED_PATHS.WORKSPACE_NAME,
    managedFieldPaths ?? []
  )

  const [workspaceName, setWorkspaceName] = useState(
    cloudIdentity?.displayName ?? settings?.name ?? ''
  )
  const [isSavingName, setIsSavingName] = useState(false)
  const [localFlags, setLocalFlags] = useState<FeatureFlags>(
    (settings?.featureFlags as FeatureFlags | undefined) ?? DEFAULT_FEATURE_FLAGS
  )
  const queryClient = useQueryClient()
  const router = useRouter()

  const productMutation = useMutation({
    mutationFn: (update: Partial<FeatureFlags>) => updateFeatureFlagsFn({ data: update }),
    onMutate: (update) => {
      let previous = localFlags
      setLocalFlags((current) => {
        previous = current
        return { ...current, ...update }
      })
      return { previous }
    },
    onSuccess: () => {
      // A product toggle flips feature-flag-driven nav entries and routes. Those
      // flags live in the root route context (getBootstrapData → settings.
      // featureFlags), which the admin sidebar reads via useRouteContext, so a
      // router.invalidate() re-runs the root beforeLoad and refreshes the flags —
      // the nav updates without a full page reload. Also refresh the portalConfig
      // query, the one settings query whose payload reflects product flags.
      void router.invalidate()
      void queryClient.invalidateQueries({ queryKey: ['settings', 'portalConfig'] })
    },
    onError: (error, _update, context) => {
      if (context?.previous) setLocalFlags(context.previous)
      toast.error(error instanceof Error ? error.message : "Couldn't update product. Try again.")
    },
  })

  // Debounced workspace name save. `useDebouncedSave` flushes any pending
  // value on unmount, so navigating away mid-debounce no longer drops it.
  const { queue: queueNameSave } = useDebouncedSave<string>(async (value) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setIsSavingName(true)
    try {
      if (cloudIdentity) {
        if (trimmed !== cloudIdentity.displayName) {
          await updateCloudIdentityFn({ data: { displayName: trimmed } })
          await router.invalidate()
        }
      } else if (trimmed !== settings?.name) {
        await updateWorkspaceNameFn({ data: { name: trimmed } })
      }
    } catch {
      toast.error('Failed to update workspace name')
    } finally {
      setIsSavingName(false)
    }
  }, 800)

  const handleNameChange = (value: string) => {
    setWorkspaceName(value)
    queueNameSave(value)
  }

  const handleProductToggle = (productId: ProductId, enabled: boolean) => {
    productMutation.mutate(getProductFlagUpdate(productId, enabled))
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={Cog6ToothIcon}
        title="General"
        description="Workspace identity and products"
      />

      <WorkspaceIdentityCard
        workspaceName={workspaceName}
        saving={isSavingName}
        managed={!cloudIdentity && workspaceNameManaged}
        onWorkspaceNameChange={handleNameChange}
        maxLength={cloudIdentity ? 80 : undefined}
      />

      <SettingsCard
        title="Products"
        description="Choose the Quackback products available to your team and customers"
      >
        <div className="divide-y divide-border/50">
          {PRODUCT_DEFINITIONS.map((product) => {
            // The public portal homepage is the feedback board, so turning this
            // one off leaves the portal root with nothing to render.
            const alwaysOn = product.id === 'feedback'
            return (
              <div
                key={product.id}
                className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 space-y-0.5">
                  <Label
                    htmlFor={alwaysOn ? undefined : `product-${product.id}`}
                    className={
                      alwaysOn ? 'text-sm font-medium' : 'cursor-pointer text-sm font-medium'
                    }
                  >
                    {product.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{product.description}</p>
                </div>
                {alwaysOn ? (
                  <Badge id={`product-${product.id}`} variant="outline">
                    Always on
                  </Badge>
                ) : (
                  <Switch
                    id={`product-${product.id}`}
                    checked={isProductEnabled(localFlags, product.id)}
                    onCheckedChange={(checked) => handleProductToggle(product.id, checked)}
                    disabled={productMutation.isPending}
                  />
                )}
              </div>
            )
          })}
        </div>
      </SettingsCard>

      <WorkspaceDangerCard cloudEnabled={Boolean(cloudIdentity)} />
    </div>
  )
}

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
