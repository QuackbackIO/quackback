import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { AUTOSAVE } from '@/lib/client/autosave'
import { SettingsCard } from '@/components/admin/settings/settings-card'
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
import { WorkspaceDataCard } from '@/components/admin/settings/workspace-data-card'
import { WorkspaceDangerCard } from '@/components/admin/settings/workspace-danger-card'
import { WorkspaceIdentityCard } from '@/components/admin/settings/workspace-identity-card'
import { readBatch } from '@/lib/client/queries/read-batch'
import { useManagedFieldPaths, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { adminPageHead } from '@/lib/client/admin-head'

const searchSchema = z.object({
  /** `logo` scrolls to the workspace logo and highlights it. */
  focus: z.enum(['logo']).optional().catch(undefined),
})

export const Route = createFileRoute('/admin/settings/general')({
  head: adminPageHead('General settings'),
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const ensure = readBatch(context.queryClient)
    const [cloudIdentity] = await Promise.all([
      getCloudIdentityFn(),
      ensure(settingsQueries.logo()),
    ])
    return { cloudIdentity }
  },
  component: GeneralSettingsPage,
})

function GeneralSettingsPage() {
  const settings = useWorkspaceSettings()
  const managedFieldPaths = useManagedFieldPaths()
  const { cloudIdentity } = Route.useLoaderData()
  const { focus } = Route.useSearch()
  const workspaceNameManaged = isPathManagedFromBootstrap(
    MANAGED_PATHS.WORKSPACE_NAME,
    managedFieldPaths ?? []
  )

  const [workspaceName, setWorkspaceName] = useState(
    cloudIdentity?.displayName ?? settings?.name ?? ''
  )
  const [localFlags, setLocalFlags] = useState<FeatureFlags>(
    (settings?.featureFlags as FeatureFlags | undefined) ?? DEFAULT_FEATURE_FLAGS
  )
  const queryClient = useQueryClient()
  const router = useRouter()

  const productMutation = useMutation({
    meta: AUTOSAVE,
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
    onError: (_error, _update, context) => {
      if (context?.previous) setLocalFlags(context.previous)
    },
  })

  const nameMutation = useMutation({
    meta: AUTOSAVE,
    mutationFn: async (trimmed: string) => {
      if (cloudIdentity) {
        if (trimmed !== cloudIdentity.displayName) {
          await updateCloudIdentityFn({ data: { displayName: trimmed } })
          await router.invalidate()
        }
      } else if (trimmed !== settings?.name) {
        await updateWorkspaceNameFn({ data: { name: trimmed } })
      }
    },
  })

  // Debounced workspace name save. `useDebouncedSave` flushes any pending
  // value on unmount, so navigating away mid-debounce does not drop it.
  const { queue: queueNameSave } = useDebouncedSave<string>((value) => {
    const trimmed = value.trim()
    if (!trimmed) return
    // The global autosave handler reports a failure.
    nameMutation.mutate(trimmed)
  }, 800)

  const handleNameChange = (value: string) => {
    setWorkspaceName(value)
    queueNameSave(value)
  }

  const handleProductToggle = (productId: ProductId, enabled: boolean) => {
    productMutation.mutate(getProductFlagUpdate(productId, enabled))
  }

  return (
    <SettingsPage page="/admin/settings/general">
      <WorkspaceIdentityCard
        workspaceName={workspaceName}
        managed={!cloudIdentity && workspaceNameManaged}
        onWorkspaceNameChange={handleNameChange}
        maxLength={cloudIdentity ? 80 : undefined}
        focusLogo={focus === 'logo'}
      />

      <SettingsCard
        title="Modules"
        description="Choose the Quackback modules available to your team and customers."
      >
        <SettingRows>
          {PRODUCT_DEFINITIONS.map((product) => {
            // The public portal homepage is the feedback board, so turning this
            // one off leaves the portal root with nothing to render.
            const alwaysOn = product.id === 'feedback'
            return (
              <SettingRow
                key={product.id}
                label={product.label}
                description={product.description}
                htmlFor={alwaysOn ? undefined : `product-${product.id}`}
                control={
                  alwaysOn ? (
                    <Badge id={`product-${product.id}`} variant="secondary">
                      Always on
                    </Badge>
                  ) : (
                    <Switch
                      id={`product-${product.id}`}
                      checked={isProductEnabled(localFlags, product.id)}
                      onCheckedChange={(checked) => handleProductToggle(product.id, checked)}
                      disabled={productMutation.isPending}
                    />
                  )
                }
              />
            )
          })}
        </SettingRows>
      </SettingsCard>

      <WorkspaceDataCard />

      <WorkspaceDangerCard cloudEnabled={Boolean(cloudIdentity)} />
    </SettingsPage>
  )
}
