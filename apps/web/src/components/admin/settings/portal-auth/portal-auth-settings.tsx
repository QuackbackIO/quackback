import { useState, useTransition, useMemo } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  EnvelopeIcon,
  KeyIcon,
  LockClosedIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'
import { AUTH_PROVIDER_ICON_MAP } from '@/components/icons/social-provider-icons'
import { AUTH_PROVIDERS } from '@/lib/server/auth/auth-providers'
import { AuthProviderCredentialsDialog } from './auth-provider-credentials-dialog'
import type { PortalAuthMethods } from '@/lib/server/domains/settings'

interface PortalAuthSettingsProps {
  initialConfig: {
    oauth: PortalAuthMethods
  }
  credentialStatus: Record<string, boolean>
}

export function PortalAuthSettings({ initialConfig, credentialStatus }: PortalAuthSettingsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [oauthState, setOauthState] = useState<Record<string, boolean | undefined>>(
    initialConfig.oauth
  )
  const [configDialog, setConfigDialog] = useState<{
    credentialType: string
    providerId: string
    providerName: string
    helpUrl?: string
    fields: {
      key: string
      label: string
      placeholder?: string
      sensitive: boolean
      helpText?: string
      helpUrl?: string
    }[]
  } | null>(null)
  const [search, setSearch] = useState('')

  // Sort providers: configured first, then alphabetical; filter by search
  const filteredProviders = useMemo(() => {
    const sorted = [...AUTH_PROVIDERS].sort((a, b) => {
      const aConfigured = credentialStatus[a.id] ? 1 : 0
      const bConfigured = credentialStatus[b.id] ? 1 : 0
      if (aConfigured !== bConfigured) return bConfigured - aConfigured
      return a.name.localeCompare(b.name)
    })
    if (!search.trim()) return sorted
    const query = search.toLowerCase()
    return sorted.filter((p) => p.name.toLowerCase().includes(query))
  }, [credentialStatus, search])

  // Count enabled auth methods to prevent disabling the last one
  const enabledMethodCount = Object.values(oauthState).filter(Boolean).length
  const isLastEnabledMethod = (providerId: string) =>
    !!oauthState[providerId] && enabledMethodCount === 1

  const saveOAuthConfig = async (oauth: Record<string, boolean | undefined>) => {
    setSaving(true)
    try {
      await updatePortalConfigFn({ data: { oauth } })
      startTransition(() => {
        router.invalidate()
      })
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = (providerId: string, checked: boolean) => {
    setOauthState((prev) => ({ ...prev, [providerId]: checked }))
    saveOAuthConfig({ [providerId]: checked })
  }

  const openConfigDialog = (provider: (typeof AUTH_PROVIDERS)[number]) => {
    // Extract helpUrl from the first field that has one (typically clientId)
    const helpUrl = provider.platformCredentials.find((f) => f.helpUrl)?.helpUrl
    setConfigDialog({
      credentialType: provider.credentialType,
      providerId: provider.id,
      providerName: provider.name,
      helpUrl,
      fields: provider.platformCredentials,
    })
  }

  return (
    <div className="space-y-8">
      {/* Password — always available, no credentials needed */}
      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">Password</h2>
          <p className="text-xs text-muted-foreground">Email and password sign in</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <KeyIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="password-toggle" className="font-medium cursor-pointer">
                    Password
                  </Label>
                  {isLastEnabledMethod('password') && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>At least one authentication method must be enabled</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Users sign in with their email and password
                </p>
              </div>
            </div>
            <Switch
              id="password-toggle"
              checked={oauthState.password ?? true}
              onCheckedChange={(checked) => handleToggle('password', checked)}
              disabled={saving || isPending || isLastEnabledMethod('password')}
              aria-label="Password authentication"
            />
          </div>
        </div>
      </div>

      {/* Email OTP — always available, no credentials needed */}
      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">Email OTP</h2>
          <p className="text-xs text-muted-foreground">Passwordless sign in with magic codes</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <EnvelopeIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="email-toggle" className="font-medium cursor-pointer">
                    Email OTP
                  </Label>
                  {isLastEnabledMethod('email') && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>At least one authentication method must be enabled</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Users receive a 6-digit code via email to sign in
                </p>
              </div>
            </div>
            <Switch
              id="email-toggle"
              checked={oauthState.email ?? false}
              onCheckedChange={(checked) => handleToggle('email', checked)}
              disabled={saving || isPending || isLastEnabledMethod('email')}
              aria-label="Email OTP authentication"
            />
          </div>
        </div>
      </div>

      {/* OAuth Providers */}
      <div>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">OAuth Providers</h2>
            <p className="text-xs text-muted-foreground">
              Allow users to sign in with third-party accounts
            </p>
          </div>
          <div className="relative w-48">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter providers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProviders.map((provider) => {
            const isConfigured = credentialStatus[provider.id]
            const isEnabled = !!oauthState[provider.id]
            const IconComponent = AUTH_PROVIDER_ICON_MAP[provider.id]

            if (!isConfigured) {
              // Unconfigured: dashed border with configure hover overlay (matches integration pattern)
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => openConfigDialog(provider)}
                  className="group relative rounded-xl border border-dashed border-border/40 bg-muted/10 p-5 text-left transition-all hover:border-border/60"
                >
                  {/* Hover overlay */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Cog6ToothIcon className="h-4 w-4" />
                      Configure
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${provider.iconBg} opacity-60`}
                    >
                      {IconComponent ? (
                        <IconComponent className="h-5 w-5 text-white" />
                      ) : (
                        <span className="text-white font-semibold text-sm">
                          {provider.name.charAt(0)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-muted-foreground">{provider.name}</h3>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 text-muted-foreground/60 border-border/40"
                        >
                          Not configured
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground/60">
                        Sign in with {provider.name}
                      </p>
                    </div>
                  </div>
                </button>
              )
            }

            // Configured: normal card with toggle (matches integration "available" card)
            return (
              <div
                key={provider.id}
                className="rounded-xl border border-border/50 bg-card p-5 shadow-sm"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${provider.iconBg}`}
                  >
                    {IconComponent ? (
                      <IconComponent className="h-5 w-5 text-white" />
                    ) : (
                      <span className="text-white font-semibold text-sm">
                        {provider.name.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{provider.name}</h3>
                      {isEnabled && (
                        <Badge
                          variant="outline"
                          className="border-green-500/30 text-green-600 text-xs"
                        >
                          Enabled
                        </Badge>
                      )}
                      {isLastEnabledMethod(provider.id) && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>At least one authentication method must be enabled</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openConfigDialog(provider)}
                      className="mt-1 text-sm text-primary hover:underline"
                    >
                      Update credentials
                    </button>
                  </div>
                  <Switch
                    id={`${provider.id}-toggle`}
                    checked={isEnabled}
                    onCheckedChange={(checked) => handleToggle(provider.id, checked)}
                    disabled={saving || isPending || isLastEnabledMethod(provider.id)}
                    className="flex-shrink-0 mt-0.5"
                  />
                </div>
              </div>
            )
          })}
        </div>
        {filteredProviders.length === 0 && search.trim() && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No providers matching &ldquo;{search}&rdquo;
          </p>
        )}
      </div>

      {/* Saving indicator */}
      {(saving || isPending) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {/* Credentials dialog */}
      {configDialog && (
        <AuthProviderCredentialsDialog
          credentialType={configDialog.credentialType}
          providerId={configDialog.providerId}
          providerName={configDialog.providerName}
          helpUrl={configDialog.helpUrl}
          fields={configDialog.fields}
          open={!!configDialog}
          onOpenChange={(open) => !open && setConfigDialog(null)}
        />
      )}
    </div>
  )
}
