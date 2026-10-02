import { useMemo, useState } from 'react'
import { Cog6ToothIcon, LockClosedIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StateBadge } from '@/components/shared/state-badge'
import { AUTH_PROVIDER_ICON_MAP } from '@/components/icons/social-provider-icons'
import { AUTH_PROVIDERS } from '@/lib/shared/auth-providers'
import { cn } from '@/lib/shared/utils'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'

type AuthProvider = (typeof AUTH_PROVIDERS)[number]
type AuthProviderId = AuthProvider['id']

export interface OAuthProviderGridProps {
  enabled: Record<string, boolean | undefined>
  credentialStatus: Record<string, boolean>
  // True when disabling this provider would leave the surface with zero auth methods.
  // Parent computes this — the grid does not know about password/magic-link rows.
  isLastMethod: (providerId: string) => boolean
  // Provider ids hidden from this grid (e.g. providers the surface configures
  // elsewhere — generic OIDC for team lives in the Single sign-on panel).
  excludeProviderIds?: readonly AuthProviderId[]
  saving?: boolean
  onToggle: (providerId: string, checked: boolean) => void
  onConfigure: (provider: AuthProvider) => void
}

export function OAuthProviderGrid({
  enabled,
  credentialStatus,
  isLastMethod,
  excludeProviderIds,
  saving = false,
  onToggle,
  onConfigure,
}: OAuthProviderGridProps) {
  const [search, setSearch] = useState('')

  // Sort providers: configured first, then alphabetical; filter by search.
  const filteredProviders = useMemo(() => {
    const excluded = new Set(excludeProviderIds ?? [])
    const sorted = AUTH_PROVIDERS.filter((p) => !excluded.has(p.id)).sort((a, b) => {
      const aConfigured = credentialStatus[a.id] ? 1 : 0
      const bConfigured = credentialStatus[b.id] ? 1 : 0
      if (aConfigured !== bConfigured) return bConfigured - aConfigured
      return a.name.localeCompare(b.name)
    })
    if (!search.trim()) return sorted
    const query = search.toLowerCase()
    return sorted.filter((p) => p.name.toLowerCase().includes(query))
  }, [credentialStatus, excludeProviderIds, search])

  return (
    <div>
      <div className="relative mb-3 ml-auto w-48">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter providers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredProviders.map((provider) => {
          const isConfigured = credentialStatus[provider.id]
          const isEnabled = !!enabled[provider.id]
          const lastMethod = isLastMethod(provider.id)
          const IconComponent = AUTH_PROVIDER_ICON_MAP[provider.id]

          const icon = (
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                provider.iconBg
              )}
            >
              {IconComponent ? (
                <IconComponent className="h-4 w-4 text-white" />
              ) : (
                <span className="text-white font-semibold text-xs">{provider.name.charAt(0)}</span>
              )}
            </div>
          )

          if (!isConfigured) {
            return (
              <button
                key={provider.id}
                type="button"
                aria-label={`Configure ${provider.name}`}
                onClick={() => onConfigure(provider)}
                className="group flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:bg-muted/40"
              >
                {icon}
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{provider.name}</p>
                <Cog6ToothIcon className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
              </button>
            )
          }

          return (
            <div
              key={provider.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 shadow-sm"
            >
              {icon}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{provider.name}</p>
                  {isEnabled && <StateBadge state="on" />}
                  {lastMethod && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <LockClosedIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>At least one sign-in method must stay enabled.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onConfigure(provider)}
                  className={`${INLINE_LINK} text-xs disabled:cursor-not-allowed`}
                >
                  Update credentials
                </button>
              </div>
              <Switch
                id={`${provider.id}-toggle`}
                checked={isEnabled}
                onCheckedChange={(checked) => onToggle(provider.id, checked)}
                disabled={saving || lastMethod}
                className="flex-shrink-0"
              />
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
  )
}
