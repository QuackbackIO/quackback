/**
 * Single sign-on (OIDC) — the SSO card on the Sign-in tab. A multi-provider
 * list backed by the `identity_provider` table, with the account's recovery
 * codes (the SSO break-glass) nested at the bottom of the same card.
 *
 * Each row surfaces the domain→visibility rule as an enforced-domain badge —
 * the same label the end user meets at login. Editing a row (or adding one)
 * opens `<ProviderEditor>`, which holds the connection / domains / mapping /
 * test sections. When the custom-OIDC tier is off, the provider list is
 * replaced by an upgrade prompt but the recovery codes stay.
 */
import { useEffect, useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import {
  ArrowTopRightOnSquareIcon,
  LockClosedIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/solid'
import type { IdentityProviderId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { IdpLogo } from '@/components/icons/idp-provider-icons'
import { cn } from '@/lib/shared/utils'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { settingsQueries } from '@/lib/client/queries/settings'
import { upsertIdentityProviderFn } from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { inferIdpKind, IDP_KIND_NAMES } from '../idp-shortcuts'
import { SsoTestSignInProvider } from '../sso/use-sso-test-sign-in'
import { RecoveryCodesSection } from '../sso/recovery-codes-section'
import { ProviderEditor } from './provider-editor'

export function IdentityProvidersSection({
  tierEnabled,
  enabledMethodCount,
}: {
  tierEnabled: boolean
  /** Total working sign-in methods across every surface. Used to block
   *  disabling a provider that is the only one left (keep ≥1 method enabled). */
  enabledMethodCount: number
}) {
  const providersQuery = useSuspenseQuery(settingsQueries.identityProviders())
  const providers = providersQuery.data ?? []

  const [editing, setEditing] = useState<
    { mode: 'new' } | { mode: 'edit'; id: IdentityProviderId } | null
  >(null)
  const editingProvider =
    editing?.mode === 'edit' ? (providers.find((p) => p.id === editing.id) ?? null) : null

  // The SSO card renders the same whether or not the tier is on — only the
  // action button and body differ (handled inline). Defined once so both
  // paths render an identical card + nested recovery codes.
  const ssoCard = (
    <SettingsCard
      title="Single sign-on (OIDC)"
      description="Okta, Auth0, Microsoft Entra, Keycloak, or any OpenID Connect IdP."
      action={
        tierEnabled ? (
          <Button type="button" size="sm" onClick={() => setEditing({ mode: 'new' })}>
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            Add provider
          </Button>
        ) : undefined
      }
    >
      {!tierEnabled ? (
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
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <ShieldCheckIcon className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <p className="text-sm font-medium">No identity providers yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Add an OIDC provider to let your team and end users sign in through it.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              enabledMethodCount={enabledMethodCount}
              onEdit={() => setEditing({ mode: 'edit', id: provider.id })}
            />
          ))}
        </ul>
      )}

      {/* Recovery codes nest here as a layout grouping for the Sign-in page,
          not a technical dependency: they're the account break-glass for when
          SSO is unavailable and also back up TOTP/2FA, so they stay shown
          regardless of the custom-OIDC tier. */}
      <RecoveryCodesSection />
    </SettingsCard>
  )

  // The SSO test flow (popup + a global postMessage listener) is only
  // reachable with the tier on (Add provider / Edit), so skip mounting its
  // provider — and its idle listener — for tier-off accounts.
  if (!tierEnabled) return ssoCard

  return (
    <SsoTestSignInProvider>
      {ssoCard}
      {editing && (
        <ProviderEditor
          key={editing.mode === 'edit' ? editing.id : 'new'}
          provider={editingProvider}
          open
          isOnlyMethod={
            enabledMethodCount === 1 && !!editingProvider?.enabled && !!editingProvider?.configured
          }
          onOpenChange={(o) => {
            if (!o) setEditing(null)
          }}
          onSaved={(saved) => setEditing({ mode: 'edit', id: saved.id })}
        />
      )}
    </SsoTestSignInProvider>
  )
}

function ProviderRow({
  provider,
  enabledMethodCount,
  onEdit,
}: {
  provider: IdentityProvider
  enabledMethodCount: number
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const upsert = useServerFn(upsertIdentityProviderFn)
  const [enabled, setEnabled] = useState(provider.enabled)
  const [pending, setPending] = useState(false)
  // Resync if the suspense query refetches with a server-side change.
  useEffect(() => setEnabled(provider.enabled), [provider.enabled])

  // Persisted choice wins; infer from the discovery URL only for legacy rows.
  const kind = provider.kind ?? inferIdpKind(provider.discoveryUrl)
  const verifiedDomains = provider.domains.filter((d) => d.verifiedAt)
  // This provider is the last thing standing between the workspace and a
  // no-auth lockout when it's the sole working method. Block turning it off;
  // turning it on is always fine.
  const isOnlyMethod = enabledMethodCount === 1 && provider.enabled && provider.configured

  // Flip just the `enabled` flag in place. Resends the required identity
  // fields (registrationId/label/clientId) unchanged so the patch validator
  // is satisfied; every other column is left untouched by the server.
  const handleToggle = async (checked: boolean) => {
    setPending(true)
    setEnabled(checked)
    try {
      await upsert({
        data: {
          id: provider.id,
          registrationId: provider.registrationId,
          label: provider.label,
          clientId: provider.clientId,
          enabled: checked,
        },
      })
      await queryClient.invalidateQueries({
        queryKey: settingsQueries.identityProviders().queryKey,
      })
    } catch (err) {
      setEnabled(!checked)
      toast.error(err instanceof Error ? err.message : 'Could not update the provider.')
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3 shadow-sm">
      <IdpLogo kind={kind} className="mt-0.5 h-8 w-8 shrink-0" iconClassName="h-[18px] w-[18px]" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{provider.label}</span>
        <p className="mt-0.5 text-xs text-muted-foreground">{IDP_KIND_NAMES[kind]}</p>
        {verifiedDomains.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {verifiedDomains.map((d) => (
              <span
                key={d.id}
                {...(d.enforced ? { title: `SSO enforced for ${d.name}` } : {})}
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
                  d.enforced
                    ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border-border/50 bg-muted/40 text-muted-foreground'
                )}
              >
                {d.enforced && <LockClosedIcon className="h-2.5 w-2.5 shrink-0" />}
                {d.name}
                {d.enforced && <span className="ml-0.5 font-medium">enforced</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className="inline-flex"
          title={isOnlyMethod ? 'At least one sign-in method must stay enabled.' : undefined}
        >
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void handleToggle(v)}
            disabled={pending || isOnlyMethod}
            aria-label={`Enable ${provider.label}`}
          />
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onEdit}
          aria-label={`Edit ${provider.label}`}
        >
          Edit
        </Button>
      </div>
    </li>
  )
}
