import { useState, useRef, useEffect, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { settingsQueries } from '@/lib/client/queries/settings'
import { updateHelpCenterSeoFn } from '@/lib/server/functions/help-center-settings'
import type { HelpCenterConfig } from '@/lib/server/domains/settings/settings.types'

export const Route = createFileRoute('/admin/settings/help-center-seo')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.helpCenterConfig())
    return {}
  },
  component: HelpCenterSeoPage,
})

function InlineSpinner({ visible }: { visible: boolean }) {
  if (!visible) return null
  return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
}

function HelpCenterSeoPage() {
  const router = useRouter()
  const helpCenterConfigQuery = useSuspenseQuery(settingsQueries.helpCenterConfig())

  const config = helpCenterConfigQuery.data as HelpCenterConfig
  const seo = config.seo

  const [metaDescription, setMetaDescription] = useState(seo?.metaDescription ?? '')
  const [sitemapEnabled, setSitemapEnabled] = useState(seo?.sitemapEnabled ?? true)
  const [structuredDataEnabled, setStructuredDataEnabled] = useState(
    seo?.structuredDataEnabled ?? true
  )
  const [saving, setSaving] = useState(false)
  const [isPending, startTransition] = useTransition()

  const metaTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (metaTimeoutRef.current) clearTimeout(metaTimeoutRef.current)
    }
  }, [])

  const isBusy = saving || isPending

  async function saveSeoField(data: Record<string, unknown>) {
    setSaving(true)
    try {
      await updateHelpCenterSeoFn({
        data: data as Parameters<typeof updateHelpCenterSeoFn>[0]['data'],
      })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  function handleMetaDescriptionChange(value: string) {
    setMetaDescription(value)
    if (metaTimeoutRef.current) clearTimeout(metaTimeoutRef.current)
    metaTimeoutRef.current = setTimeout(() => {
      saveSeoField({ metaDescription: value })
    }, 800)
  }

  function handleSitemapToggle(checked: boolean) {
    setSitemapEnabled(checked)
    saveSeoField({ sitemapEnabled: checked })
  }

  function handleStructuredDataToggle(checked: boolean) {
    setStructuredDataEnabled(checked)
    saveSeoField({ structuredDataEnabled: checked })
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={MagnifyingGlassIcon}
        title="Help Center SEO"
        description="Optimize your help center for search engines"
      />

      {/* Meta Description */}
      <SettingsCard
        title="Meta Description"
        description="Default meta description template used for help center pages"
      >
        <div className="space-y-1.5">
          <Label htmlFor="meta-description" className="text-sm font-medium">
            Description Template
          </Label>
          <textarea
            id="meta-description"
            value={metaDescription}
            onChange={(e) => handleMetaDescriptionChange(e.target.value)}
            placeholder="Browse our help center for guides, tutorials, and answers to common questions."
            rows={3}
            disabled={isBusy}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Used as the default meta description for help center pages that do not have their own
          </p>
        </div>
      </SettingsCard>

      {/* Sitemap */}
      <SettingsCard
        title="Sitemap"
        description="Control whether a sitemap is generated for your help center"
      >
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="sitemap-toggle" className="text-sm font-medium cursor-pointer">
              Enable Sitemap
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Generate an XML sitemap for search engines to discover your help center articles
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={isBusy} />
            <Switch
              id="sitemap-toggle"
              checked={sitemapEnabled}
              onCheckedChange={handleSitemapToggle}
              disabled={isBusy}
              aria-label="Enable Sitemap"
            />
          </div>
        </div>
      </SettingsCard>

      {/* Structured Data */}
      <SettingsCard
        title="Structured Data"
        description="Add schema.org structured data to help center pages"
      >
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
          <div>
            <Label htmlFor="structured-data-toggle" className="text-sm font-medium cursor-pointer">
              Enable Structured Data
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add JSON-LD structured data to articles for rich search results and FAQ snippets
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlineSpinner visible={isBusy} />
            <Switch
              id="structured-data-toggle"
              checked={structuredDataEnabled}
              onCheckedChange={handleStructuredDataToggle}
              disabled={isBusy}
              aria-label="Enable Structured Data"
            />
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
