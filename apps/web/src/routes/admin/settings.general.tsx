import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Cog6ToothIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { FeatureFlagSections } from '@/components/admin/settings/feature-flag-sections'
import { Button } from '@/components/ui/button'
import { updateWorkspaceNameFn } from '@/lib/server/functions/settings'
import {
  getCloudIdentityFn,
  platformLabelFromHostname,
  updateCloudIdentityFn,
} from '@/lib/server/functions/cloud-identity'
import { updateFeatureFlagsFn } from '@/lib/server/functions/feature-flags'
import { useDebouncedSave } from '@/lib/client/hooks/use-debounced-save'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '@/lib/client/config-file'
import {
  DEFAULT_FEATURE_FLAGS,
  GA_FEATURE_SECTIONS,
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
    return { cloudIdentity: await getCloudIdentityFn() }
  },
  component: GeneralSettingsPage,
})

function GeneralSettingsPage() {
  const { settings, managedFieldPaths } = Route.useRouteContext()
  const { cloudIdentity: initialCloudIdentity } = Route.useLoaderData()
  const workspaceNameManaged = isPathManagedFromBootstrap(
    MANAGED_PATHS.WORKSPACE_NAME,
    managedFieldPaths ?? []
  )

  const [cloudIdentity, setCloudIdentity] = useState(initialCloudIdentity)
  const [workspaceName, setWorkspaceName] = useState(
    initialCloudIdentity?.displayName ?? settings?.name ?? ''
  )
  const [platformLabel, setPlatformLabel] = useState(
    initialCloudIdentity?.platformHostname
      ? platformLabelFromHostname(initialCloudIdentity.platformHostname)
      : ''
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

  const identityMutation = useMutation({
    mutationFn: () => {
      const requestedLabel = platformLabel.trim()
      return updateCloudIdentityFn({
        data: {
          displayName: workspaceName.trim(),
          ...(requestedLabel ? { platformLabel: requestedLabel } : {}),
        },
      })
    },
    onSuccess: async (result) => {
      setCloudIdentity(result.projection)
      setWorkspaceName(result.projection.displayName)
      setPlatformLabel(
        result.projection.platformHostname
          ? platformLabelFromHostname(result.projection.platformHostname)
          : ''
      )
      if (result.transferToken) {
        const target = new URL('/auth/origin-transfer', result.projection.canonicalOrigin)
        target.searchParams.set('ott', result.transferToken)
        target.searchParams.set('returnTo', '/admin/settings/general')
        window.location.assign(target)
        return
      }
      toast.success('Workspace details saved')
      await router.invalidate()
    },
  })

  // Debounced workspace name save. `useDebouncedSave` flushes any pending
  // value on unmount, so navigating away mid-debounce no longer drops it.
  const { queue: queueNameSave } = useDebouncedSave<string>(async (value) => {
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

  const handleNameChange = (value: string) => {
    setWorkspaceName(value)
    if (!cloudIdentity) queueNameSave(value)
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

      {cloudIdentity ? (
        <CloudWorkspaceDetails
          workspaceName={workspaceName}
          platformLabel={platformLabel}
          domainSuffix={new URL(cloudIdentity.canonicalOrigin).hostname
            .split('.')
            .slice(1)
            .join('.')}
          currentOrigin={cloudIdentity.canonicalOrigin}
          pending={identityMutation.isPending}
          error={identityMutation.error}
          onWorkspaceNameChange={setWorkspaceName}
          onPlatformLabelChange={setPlatformLabel}
          onSubmit={() => identityMutation.mutate()}
        />
      ) : (
        <LocalWorkspaceNameCard
          workspaceName={workspaceName}
          saving={isSavingName}
          managed={workspaceNameManaged}
          onWorkspaceNameChange={handleNameChange}
        />
      )}

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
                    htmlFor={`product-${product.id}`}
                    className={
                      alwaysOn ? 'text-sm font-medium' : 'cursor-pointer text-sm font-medium'
                    }
                  >
                    {product.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{product.description}</p>
                  {alwaysOn && (
                    <p className="text-xs text-muted-foreground">
                      {product.label} is always enabled
                    </p>
                  )}
                </div>
                <Switch
                  id={`product-${product.id}`}
                  checked={alwaysOn || isProductEnabled(localFlags, product.id)}
                  onCheckedChange={(checked) => handleProductToggle(product.id, checked)}
                  disabled={alwaysOn || productMutation.isPending}
                />
              </div>
            )
          })}
        </div>
      </SettingsCard>

      <FeatureFlagSections
        sections={GA_FEATURE_SECTIONS}
        flags={localFlags}
        pending={productMutation.isPending}
        onToggle={(key, value) => productMutation.mutate({ [key]: value })}
      />

      <WorkspaceDangerCard cloudEnabled={Boolean(cloudIdentity)} />
    </div>
  )
}

export function LocalWorkspaceNameCard(props: {
  workspaceName: string
  saving: boolean
  managed: boolean
  onWorkspaceNameChange: (value: string) => void
}) {
  return (
    <SettingsCard title="Workspace" description="The name shown across the portal and emails">
      <div className="max-w-md space-y-1.5">
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
    </SettingsCard>
  )
}

export function CloudWorkspaceDetails(props: {
  workspaceName: string
  platformLabel: string
  domainSuffix: string
  currentOrigin: string
  pending: boolean
  error: Error | null
  onWorkspaceNameChange: (value: string) => void
  onPlatformLabelChange: (value: string) => void
  onSubmit: () => void
}) {
  const preview = `https://${props.platformLabel || 'workspace'}.${props.domainSuffix}`
  return (
    <SettingsCard
      title="Workspace details"
      description="The name and Quackback address customers use for this workspace"
    >
      <form
        className="max-w-xl space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          props.onSubmit()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="workspace-name" className="text-xs text-muted-foreground">
            Workspace name
          </Label>
          <Input
            id="workspace-name"
            value={props.workspaceName}
            onChange={(event) => props.onWorkspaceNameChange(event.target.value)}
            placeholder="Untitled workspace"
            maxLength={80}
            disabled={props.pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="platform-label" className="text-xs text-muted-foreground">
            Quackback URL
          </Label>
          <div className="flex items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
            <Input
              id="platform-label"
              value={props.platformLabel}
              onChange={(event) => props.onPlatformLabelChange(event.target.value)}
              className="border-0 focus-visible:ring-0"
              maxLength={63}
              autoCapitalize="none"
              autoCorrect="off"
              disabled={props.pending}
            />
            <span className="shrink-0 pe-3 text-sm text-muted-foreground">
              .{props.domainSuffix}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Preview: <span className="font-mono">{preview}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Current: <span className="font-mono">{props.currentOrigin}</span>
          </p>
        </div>
        {props.error && (
          <p role="alert" className="text-sm text-destructive">
            {props.error.message || 'Could not save workspace details. Try again.'}
          </p>
        )}
        <Button type="submit" disabled={props.pending || !props.workspaceName.trim()}>
          {props.pending && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
          Save workspace details
        </Button>
      </form>
    </SettingsCard>
  )
}
