import { useState, useRef, useEffect, useTransition } from 'react'
import { createFileRoute, useRouter, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  BookOpenIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
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
  const { baseUrl } = useRouteContext({ from: '__root__' })
  const config = helpCenterConfigQuery.data as HelpCenterConfig

  const [enabled, setEnabled] = useState(config.enabled)
  const [customDomain, setCustomDomain] = useState(config.customDomain ?? '')
  const [homepageTitle, setHomepageTitle] = useState(config.homepageTitle)
  const [homepageDescription, setHomepageDescription] = useState(config.homepageDescription)
  const [access, setAccess] = useState<'public' | 'authenticated'>(config.access)
  const [saving, setSaving] = useState(false)
  const [isPending, startTransition] = useTransition()

  const titleTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const descTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const domainTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current)
      if (descTimeoutRef.current) clearTimeout(descTimeoutRef.current)
      if (domainTimeoutRef.current) clearTimeout(domainTimeoutRef.current)
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

  function handleCustomDomainChange(value: string) {
    setCustomDomain(value)
    if (domainTimeoutRef.current) clearTimeout(domainTimeoutRef.current)
    domainTimeoutRef.current = setTimeout(() => {
      saveField({ customDomain: value.trim() || null })
    }, 800)
  }

  function handleAccessChange(value: 'public' | 'authenticated') {
    setAccess(value)
    saveField({ access: value })
  }

  const helpUrl = `${baseUrl ?? ''}/help`
  const cnameTarget = 'help-proxy.quackback.app'

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

      {/* Domain */}
      <SettingsCard title="Domain" description="Where your help center is accessible">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Help Center URL</Label>
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
              <code className="text-sm font-mono text-foreground flex-1">{helpUrl}</code>
              <a
                href={helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-domain" className="text-sm font-medium">
              Custom Domain
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="custom-domain"
                value={customDomain}
                onChange={(e) => handleCustomDomainChange(e.target.value)}
                placeholder="help.yourdomain.com"
                disabled={isBusy}
              />
              {config.customDomain && (
                <div className="flex items-center gap-1 shrink-0">
                  {config.domainVerified ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                      <CheckCircleIcon className="h-4 w-4" />
                      Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-500">
                      <XCircleIcon className="h-4 w-4" />
                      Pending
                    </span>
                  )}
                </div>
              )}
            </div>
            {customDomain && !config.domainVerified && (
              <p className="text-xs text-muted-foreground">
                Point a CNAME record to <code className="text-xs font-mono">{cnameTarget}</code>
              </p>
            )}
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

      {/* Access Control */}
      <SettingsCard title="Access" description="Control who can view your help center">
        <div className="space-y-3">
          <label className="flex items-center gap-3 rounded-lg border border-border/50 p-4 cursor-pointer transition-colors hover:bg-muted/30">
            <input
              type="radio"
              name="access"
              value="public"
              checked={access === 'public'}
              onChange={() => handleAccessChange('public')}
              disabled={isBusy}
              className="accent-primary"
            />
            <div>
              <span className="text-sm font-medium">Public</span>
              <p className="text-xs text-muted-foreground">
                Anyone can view help center articles without signing in
              </p>
            </div>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border/50 p-4 cursor-pointer transition-colors hover:bg-muted/30">
            <input
              type="radio"
              name="access"
              value="authenticated"
              checked={access === 'authenticated'}
              onChange={() => handleAccessChange('authenticated')}
              disabled={isBusy}
              className="accent-primary"
            />
            <div>
              <span className="text-sm font-medium">Authenticated Only</span>
              <p className="text-xs text-muted-foreground">
                Only signed-in users can view help center articles
              </p>
            </div>
          </label>
        </div>
      </SettingsCard>
    </div>
  )
}
