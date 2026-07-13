'use client'

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useTransition } from 'react'
import { Cog6ToothIcon, CheckCircleIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/shared/spinner'
import { toast } from 'sonner'
import { adminQueries } from '@/lib/client/queries/admin'
import { useRouteContext } from '@tanstack/react-router'
import type { PortalTabConfig } from '@/lib/server/domains/portal/types'
import type { FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/portal-tabs')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.portalTabConfig()),
      queryClient.ensureQueryData(adminQueries.segmentList()),
    ])

    return {}
  },
  component: PortalTabsSettingsPage,
})

const TAB_LABELS: Record<string, { id: string; label: string; description: string }> = {
  feedback: {
    id: 'portal.settings.tabs.feedback',
    label: 'Feedback',
    description: 'Portal home page with feedback posts and voting',
  },
  roadmap: {
    id: 'portal.settings.tabs.roadmap',
    label: 'Roadmap',
    description: 'Public roadmap view showing planned features',
  },
  changelog: {
    id: 'portal.settings.tabs.changelog',
    label: 'Changelog',
    description: 'Product changelog and release updates',
  },
  myTickets: {
    id: 'portal.settings.tabs.myTickets',
    label: 'My Tickets',
    description: 'Signed-in users can view their support tickets',
  },
  helpCenter: {
    id: 'portal.settings.tabs.helpCenter',
    label: 'Help Center',
    description: 'Knowledge base and help articles',
  },
  support: {
    id: 'portal.settings.tabs.support',
    label: 'Support',
    description: 'Live chat and support conversations',
  },
}

function PortalTabsSettingsPage() {
  const router = useRouter()
  const [_isPending, startTransition] = useTransition()
  const { settings } = useRouteContext({ from: '__root__' })

  const configQuery = useSuspenseQuery(adminQueries.portalTabConfig())
  const segmentsQuery = useSuspenseQuery(adminQueries.segmentList())

  const flags = settings?.featureFlags as FeatureFlags | undefined
  const featureEnabled =
    (flags as (FeatureFlags & { portalTabCustomization?: boolean }) | undefined)
      ?.portalTabCustomization ?? true

  // Feature gate: show message if not available on plan
  if (!featureEnabled) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="lg:hidden">
          <BackLink to="/admin/settings">Settings</BackLink>
        </div>
        <PageHeader
          icon={Cog6ToothIcon}
          title="Portal Tabs"
          description="Configure which tabs are visible in the portal for different user groups"
        />
        <SettingsCard title="Feature Not Available" description="">
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <LockClosedIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">
                Portal tab customization is not available on your plan
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Upgrade to unlock fine-grained portal tab visibility controls for user segments.
              </p>
            </div>
          </div>
        </SettingsCard>
      </div>
    )
  }

  const [orgConfig, setOrgConfig] = useState<PortalTabConfig>(configQuery.data || {})
  const [segmentOverrides, setSegmentOverrides] = useState<Map<string, PortalTabConfig>>(new Map())
  const [saving, setSaving] = useState(false)
  const segments = (segmentsQuery.data ?? []) as Array<{
    id: string
    name: string
    description?: string | null
  }>

  async function handleOrgConfigSave() {
    setSaving(true)
    try {
      const { updatePortalTabConfigFn } = await import('@/lib/server/functions/settings')
      await updatePortalTabConfigFn({ data: { config: orgConfig } })
      toast.success('Saved', {
        description: 'Portal tab configuration updated',
      })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Error', {
        description: 'Failed to save portal tab configuration',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleSegmentOverrideSave(segmentId: string) {
    setSaving(true)
    try {
      const { updateSegmentTabOverridesFn } = await import('@/lib/server/functions/settings')
      const overrides = segmentOverrides.get(segmentId)
      if (!overrides) return

      await updateSegmentTabOverridesFn({ data: { segmentId, overrides } })
      toast.success('Saved', {
        description: 'Segment tab configuration updated',
      })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Error', {
        description: 'Failed to save segment tab configuration',
      })
    } finally {
      setSaving(false)
    }
  }

  const toggleOrgTab = (tab: keyof PortalTabConfig) => {
    setOrgConfig((prev) => ({
      ...prev,
      [tab]: prev[tab] === false, // flip: false→true, true/undefined→false
    }))
  }

  const toggleSegmentTab = (segmentId: string, tab: keyof PortalTabConfig) => {
    setSegmentOverrides((prev) => {
      const current = prev.get(segmentId) ?? { ...orgConfig }
      const updated = new Map(prev)
      updated.set(segmentId, {
        ...current,
        [tab]: current[tab] === false, // flip: false→true, true/undefined→false
      })
      return updated
    })
  }

  if (!configQuery.data) {
    return <Spinner />
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={Cog6ToothIcon}
        title="Portal Tabs"
        description="Configure which tabs are visible in the portal for different user groups"
      />

      {/* Organization-Level Configuration */}
      <SettingsCard
        title="Default Tab Visibility"
        description="These settings control which tabs are visible to all portal users by default"
      >
        <div className="space-y-4">
          {Object.entries(TAB_LABELS).map(([tabKey, { label, description }]) => (
            <div
              key={tabKey}
              className="flex items-start justify-between py-3 border-b border-border/50 last:border-0"
            >
              <div className="flex-1">
                <Label className="text-sm font-medium">{label}</Label>
                <p className="text-xs text-muted-foreground mt-1">{description}</p>
              </div>
              <Switch
                checked={orgConfig[tabKey as keyof PortalTabConfig] !== false}
                onCheckedChange={() => toggleOrgTab(tabKey as keyof PortalTabConfig)}
                disabled={saving}
              />
            </div>
          ))}
        </div>
        <Button onClick={handleOrgConfigSave} disabled={saving} className="mt-6">
          {saving ? (
            <Spinner className="mr-2 h-4 w-4" />
          ) : (
            <CheckCircleIcon className="mr-2 h-4 w-4" />
          )}
          Save Defaults
        </Button>
      </SettingsCard>

      {/* Segment-Level Overrides */}
      {segments.length > 0 && (
        <SettingsCard
          title="Segment Overrides"
          description="Configure different tab visibility for specific user segments. These settings override the defaults above."
        >
          <div className="space-y-6">
            {segments.map((segment: { id: string; name: string; description?: string | null }) => (
              <div key={segment.id} className="border border-border/50 rounded-lg p-4">
                <div className="mb-4">
                  <h4 className="font-medium text-sm">{segment.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {segment.description || 'No description'}
                  </p>
                </div>
                <div className="space-y-3">
                  {Object.entries(TAB_LABELS).map(([tabKey, { label }]) => (
                    <div
                      key={tabKey}
                      className="flex items-center justify-between py-2 pl-2 pr-3 rounded hover:bg-accent/50"
                    >
                      <Label className="text-sm cursor-pointer">{label}</Label>
                      <Switch
                        checked={
                          (segmentOverrides.get(segment.id)?.[tabKey as keyof PortalTabConfig] ??
                            orgConfig[tabKey as keyof PortalTabConfig]) !== false
                        }
                        onCheckedChange={() =>
                          toggleSegmentTab(segment.id, tabKey as keyof PortalTabConfig)
                        }
                        disabled={saving}
                      />
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSegmentOverrideSave(segment.id)}
                  disabled={saving || !segmentOverrides.has(segment.id)}
                  className="mt-4"
                >
                  Save Overrides
                </Button>
              </div>
            ))}
          </div>
        </SettingsCard>
      )}
    </div>
  )
}
