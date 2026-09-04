/**
 * Identity provider detail — one page per provider, stacked cards, one save
 * each.
 *
 * This replaced a dialog with three tabs. The dialog had two structural
 * problems a page fixes rather than rearranges: `enabled` was readable but not
 * settable here, so an admin could configure a provider, test it, save, close,
 * and still have nobody able to sign in; and everything shared a single Save,
 * so a domain change and a claim-mapping change were the same commit even
 * though they carry very different risk.
 *
 * The header therefore carries the enabled toggle as a real control alongside
 * the status the admin needs to read the provider at a glance, and each card
 * below persists only its own fields.
 */
import { useEffect, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import type { IdentityProviderId } from '@quackback/ids'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { BackLink } from '@/components/ui/back-link'
import { TimeAgo } from '@/components/ui/time-ago'
import { IdpLogo } from '@/components/icons/idp-provider-icons'
import { MENU_ROW } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { inferIdpKind, IDP_KIND_NAMES } from '../idp-shortcuts'
import { countEnabledAuthMethods } from '../auth-method-count'
import { SsoTestSignInProvider } from '../sso/use-sso-test-sign-in'
import { AccountsCard } from './accounts-card'
import { ClaimMappingCard } from './claim-mapping-card'
import { ConnectionCard } from './connection-card'
import { DangerCard } from './danger-card'
import { SignInCard } from './sign-in-card'
import {
  getConnectionTestState,
  identityMappingIssue,
  isOnlyWorkingMethod,
  SIGN_IN_TAB,
} from './provider-shared'
import { useProviderSave } from './use-provider-save'

const SECTIONS = [
  { id: 'connection', label: 'Connection' },
  { id: 'signin', label: 'Sign-in' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'mapping', label: 'Claim mapping' },
  { id: 'danger', label: 'Remove' },
] as const

export function ProviderDetailPage({ providerId }: { providerId: IdentityProviderId }) {
  const providers = useSuspenseQuery(settingsQueries.identityProviders()).data ?? []
  const provider = providers.find((p) => p.id === providerId) ?? null

  if (!provider) {
    return (
      <div className="max-w-3xl space-y-6">
        <BackLink {...SIGN_IN_TAB}>Sign-in</BackLink>
        <p className="text-sm text-muted-foreground">Identity provider not found.</p>
      </div>
    )
  }

  return (
    // The test flow (popup + a global postMessage listener) is owned here so
    // the connection test and the claim-path suggestions share one modal and
    // one "last successful test" result.
    <SsoTestSignInProvider>
      <ProviderDetailBody provider={provider} />
    </SsoTestSignInProvider>
  )
}

function ProviderDetailBody({ provider }: { provider: IdentityProvider }) {
  const enabledMethodCount = useEnabledMethodCount()
  const isOnlyMethod = isOnlyWorkingMethod(provider, enabledMethodCount)

  return (
    <div className="max-w-5xl space-y-6">
      <BackLink {...SIGN_IN_TAB}>Sign-in</BackLink>
      <ProviderHeader provider={provider} isOnlyMethod={isOnlyMethod} />
      <div className="flex gap-8">
        <SectionNav />
        <div className="min-w-0 flex-1 space-y-6">
          <ConnectionCard provider={provider} />
          <SignInCard provider={provider} />
          <AccountsCard provider={provider} />
          <ClaimMappingCard provider={provider} />
          <DangerCard provider={provider} isOnlyMethod={isOnlyMethod} />
        </div>
      </div>
    </div>
  )
}

/**
 * Working sign-in methods across every surface. The "keep at least one method
 * enabled" guard spans built-in email, social OAuth and the identity_provider
 * table, so the enable toggle and the Remove control both need the whole count,
 * not just this provider's state.
 */
function useEnabledMethodCount(): number {
  const providers = useSuspenseQuery(settingsQueries.identityProviders()).data ?? []
  const authConfig = useSuspenseQuery(settingsQueries.authConfig()).data
  const credentialStatus = useSuspenseQuery(adminQueries.authProviderStatus()).data
  return countEnabledAuthMethods({
    oauthState: (authConfig.oauth ?? {}) as Record<string, boolean | undefined>,
    emailConfigured: credentialStatus._emailConfigured !== false,
    credentialStatus,
    identityProviders: providers,
  })
}

function ProviderHeader({
  provider,
  isOnlyMethod,
}: {
  provider: IdentityProvider
  isOnlyMethod: boolean
}) {
  const { saving, save } = useProviderSave(provider)
  const [enabled, setEnabled] = useState(provider.enabled)
  // Resync when the query refetches with a server-side change.
  useEffect(() => setEnabled(provider.enabled), [provider.enabled])

  const kind = provider.kind ?? inferIdpKind(provider.discoveryUrl)
  const mappingIssue = identityMappingIssue(provider.claimMapping)

  const toggle = async (checked: boolean) => {
    setEnabled(checked)
    const ok = await save(
      { enabled: checked },
      checked ? 'Provider enabled.' : 'Provider disabled.'
    )
    if (!ok) setEnabled(!checked)
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {provider.logoUrl ? (
          <img
            src={provider.logoUrl}
            alt=""
            className="mt-0.5 h-9 w-9 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <IdpLogo kind={kind} className="mt-0.5 h-9 w-9 shrink-0" iconClassName="h-5 w-5" />
        )}
        <div className="min-w-0 space-y-1.5">
          <h1 className="truncate text-lg font-semibold">{provider.label}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge size="sm" shape="pill" variant={enabled ? 'default' : 'outline'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Badge size="sm" shape="pill" variant="subtle">
              {IDP_KIND_NAMES[kind]} · OpenID Connect
            </Badge>
            <TestStatePill provider={provider} />
            {mappingIssue && (
              <Badge
                size="sm"
                shape="pill"
                variant="outline"
                className="border-amber-500/40 text-amber-700 dark:text-amber-400"
              >
                <ExclamationTriangleIcon />
                {mappingIssue}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Enabled is a real control here, not a read-out. Configuring, testing
          and saving a provider nobody can actually use was the most reachable
          dead end in the dialog. */}
      <label
        className="flex shrink-0 items-center gap-2 text-sm"
        title={isOnlyMethod ? 'At least one sign-in method must stay enabled.' : undefined}
      >
        <span className="text-muted-foreground">Enabled</span>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void toggle(v)}
          disabled={saving || isOnlyMethod}
          aria-label={`Enable ${provider.label}`}
        />
      </label>
    </div>
  )
}

/** Connection-test freshness as a pill. An enabled provider with no saved
 *  secret registers nothing, so that outranks the test state. */
function TestStatePill({ provider }: { provider: IdentityProvider }) {
  if (!provider.configured) {
    return (
      <Badge size="sm" shape="pill" variant="outline">
        No client secret
      </Badge>
    )
  }
  const state = getConnectionTestState(provider)
  if (state.kind === 'verified') {
    return (
      <Badge
        size="sm"
        shape="pill"
        variant="outline"
        className="border-green-500/40 text-green-700 dark:text-green-400"
      >
        <CheckCircleIcon />
        Tested <TimeAgo date={state.testedAt} />
      </Badge>
    )
  }
  if (state.kind === 'stale') {
    return (
      <Badge
        size="sm"
        shape="pill"
        variant="outline"
        className="border-amber-500/40 text-amber-700 dark:text-amber-400"
      >
        <ClockIcon />
        Re-test needed
      </Badge>
    )
  }
  return (
    <Badge size="sm" shape="pill" variant="outline">
      Not tested
    </Badge>
  )
}

/**
 * Anchored section nav. Plain in-page links rather than a scroll spy: every
 * section is mounted, so the browser's own anchor behaviour is enough and
 * there is no observer state to fall out of sync with the page.
 */
function SectionNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id)

  useEffect(() => {
    const sync = () => setActive(window.location.hash.slice(1) || SECTIONS[0].id)
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return (
    <nav aria-label="Provider settings" className="hidden w-40 shrink-0 lg:block">
      <ul className="sticky top-6 space-y-0.5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={() => setActive(s.id)}
              aria-current={active === s.id ? 'true' : undefined}
              className={cn(
                MENU_ROW,
                'hover:bg-muted/60 hover:text-foreground',
                active === s.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'
              )}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
