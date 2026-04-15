import { useState, useRef, useEffect, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { BookOpenIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { settingsQueries } from '@/lib/client/queries/settings'
import { updateHelpCenterConfigFn } from '@/lib/server/functions/help-center-settings'
import type { HelpCenterConfig } from '@/lib/server/domains/settings/settings.types'

export const Route = createFileRoute('/admin/settings/help-center')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.helpCenterConfig())
    return {}
  },
  component: HelpCenterSettingsPage,
})

function InlineSpinner({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
}

function HelpCenterSettingsPage() {
  const router = useRouter()
  const helpCenterConfigQuery = useSuspenseQuery(settingsQueries.helpCenterConfig())
  const config = helpCenterConfigQuery.data as HelpCenterConfig

  const [enabled, setEnabled] = useState(config.enabled)
  const [homepageTitle, setHomepageTitle] = useState(config.homepageTitle)
  const [homepageDescription, setHomepageDescription] = useState(config.homepageDescription)
  const [saving, setSaving] = useState(false)
  const [isPending, startTransition] = useTransition()

  const titleTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const descTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current)
      if (descTimeoutRef.current) clearTimeout(descTimeoutRef.current)
    }
  }, [])

  const isBusy = saving || isPending

  async function saveField(data: Record<string, unknown>) {
    setSaving(true)
    try {
      await updateHelpCenterConfigFn({
        data: data as Parameters<typeof updateHelpCenterConfigFn>[0]['data'],
      })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  function handleEnabledToggle(checked: boolean) {
    setEnabled(checked)
    saveField({ enabled: checked })
  }

  function handleTitleChange(value: string) {
    setHomepageTitle(value)
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current)
    titleTimeoutRef.current = setTimeout(() => {
      if (value.trim()) {
        saveField({ homepageTitle: value.trim() })
      }
    }, 800)
  }

  function handleDescriptionChange(value: string) {
    setHomepageDescription(value)
    if (descTimeoutRef.current) clearTimeout(descTimeoutRef.current)
    descTimeoutRef.current = setTimeout(() => {
      saveField({ homepageDescription: value })
    }, 800)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={BookOpenIcon}
        title="Help Center"
        description="Configure your help center knowledge base"
      />

      {/* Enable / Disable */}
      <SettingsCard
        title="Help Center"
        description="Enable or disable the help center for your users"
      >
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="hc-enable" className="text-sm font-medium cursor-pointer">
              Enable Help Center
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, your help center will be accessible to users
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={isBusy} />
            <Switch
              id="hc-enable"
              checked={enabled}
              onCheckedChange={handleEnabledToggle}
              disabled={isBusy}
              aria-label="Enable Help Center"
            />
          </div>
        </div>
      </SettingsCard>

      {/* Homepage */}
      <SettingsCard title="Homepage" description="Customize the help center landing page">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="homepage-title" className="text-sm font-medium">
              Title
            </Label>
            <Input
              id="homepage-title"
              value={homepageTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="How can we help?"
              disabled={isBusy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="homepage-description" className="text-sm font-medium">
              Description
            </Label>
            <Input
              id="homepage-description"
              value={homepageDescription}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              placeholder="Search our knowledge base or browse by category"
              disabled={isBusy}
            />
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
