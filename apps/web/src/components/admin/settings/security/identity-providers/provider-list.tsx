/**
 * Identity-providers list — the "IDENTITY PROVIDERS (OIDC)" section of the
 * Sign-in providers tab (spec §11.2). Replaces the single `CustomOidcCard`
 * with a multi-provider list backed by the `identity_provider` table.
 *
 * Each row surfaces the domain→visibility rule (D5) as a `[button]` /
 * `[routed]` badge — the same label the end user meets at login. Editing a
 * row (or adding one) opens `<ProviderEditor>`, which absorbs the former
 * single-SSO connection / domains / mapping / test sections.
 */
import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, PlusIcon, ShieldCheckIcon } from '@heroicons/react/24/solid'
import type { IdentityProviderId } from '@quackback/ids'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { settingsQueries } from '@/lib/client/queries/settings'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { inferIdpKind, type IdpKind } from '../idp-shortcuts'
import { SsoTestSignInProvider } from '../sso/use-sso-test-sign-in'
import { ProviderEditor } from './provider-editor'

const IDP_KIND_NAMES: Record<IdpKind, string> = {
  okta: 'Okta',
  auth0: 'Auth0',
  entra: 'Microsoft Entra',
  keycloak: 'Keycloak',
  google: 'Google Workspace',
  other: 'Custom OIDC',
}

/** `routed` when ≥1 linked domain is verified; `button` otherwise. The DTO
 *  already carries this (Task 10), but recompute defensively so the badge is
 *  correct even if an older payload omits it. */
function visibilityOf(provider: IdentityProvider): 'button' | 'routed' {
  return provider.visibility ?? (provider.domains.some((d) => d.verifiedAt) ? 'routed' : 'button')
}

export function IdentityProvidersSection({ tierEnabled }: { tierEnabled: boolean }) {
  const providersQuery = useSuspenseQuery(settingsQueries.identityProviders())
  const providers = providersQuery.data ?? []

  const [editing, setEditing] = useState<
    { mode: 'new' } | { mode: 'edit'; id: IdentityProviderId } | null
  >(null)
  const editingProvider =
    editing?.mode === 'edit' ? (providers.find((p) => p.id === editing.id) ?? null) : null

  if (!tierEnabled) {
    return (
      <SettingsCard
        title="Identity providers (OIDC)"
        description="Bring your own OpenID Connect IdP for portal and admin sign-in."
      >
        <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Available on plans with the custom OIDC feature.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href="https://www.quackback.io/pricing" target="_blank" rel="noopener noreferrer">
              Upgrade plan
              <ArrowTopRightOnSquareIcon className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </SettingsCard>
    )
  }

  return (
    <SsoTestSignInProvider>
      <SettingsCard
        title="Identity providers (OIDC)"
        description="Okta, Auth0, Microsoft Entra, Keycloak, or any OpenID Connect IdP."
        contentClassName="p-0"
        action={
          <Button type="button" size="sm" onClick={() => setEditing({ mode: 'new' })}>
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            Add provider
          </Button>
        }
      >
        {providers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <ShieldCheckIcon className="h-5 w-5 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-medium">No identity providers yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Add an OIDC provider to let your team and end users sign in through it.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onEdit={() => setEditing({ mode: 'edit', id: provider.id })}
              />
            ))}
          </ul>
        )}
      </SettingsCard>

      {editing && (
        <ProviderEditor
          key={editing.mode === 'edit' ? editing.id : 'new'}
          provider={editingProvider}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null)
          }}
          onSaved={(saved) => setEditing({ mode: 'edit', id: saved.id })}
        />
      )}
    </SsoTestSignInProvider>
  )
}

function ProviderRow({ provider, onEdit }: { provider: IdentityProvider; onEdit: () => void }) {
  const visibility = visibilityOf(provider)
  const kind = inferIdpKind(provider.discoveryUrl)
  const host = (() => {
    if (!provider.discoveryUrl) return null
    try {
      return new URL(provider.discoveryUrl).host
    } catch {
      return null
    }
  })()
  const verifiedDomains = provider.domains.filter((d) => d.verifiedAt)
  const domainSummary =
    verifiedDomains.length === 0
      ? 'no domains'
      : verifiedDomains
          .map((d) => `${d.name}${d.enforced ? ' (enforced)' : ''}`)
          .join(', ')

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold">{provider.label}</span>
          {provider.enabled && (
            <Badge
              variant="outline"
              className="border-green-500/30 px-1.5 py-0 text-[10px] text-green-600"
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-600" />
              Active
            </Badge>
          )}
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {visibility}
          </Badge>
          <span className="text-xs text-muted-foreground">{domainSummary}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {IDP_KIND_NAMES[kind]}
          {host ? ` · ${host}` : ''}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={onEdit}
        aria-label={`Edit ${provider.label}`}
      >
        Edit
      </Button>
    </li>
  )
}
