/**
 * Identity provider detail — one page per provider, three sections.
 *
 * Connection: is it working. Sign-in & access: who is sent here and what they
 * get. User details: what is read about them. Each section saves only its own
 * fields; a domain change and a claim-mapping change carry very different risk
 * and are never the same commit.
 *
 * The header carries Enabled as a real control. Configuring, testing and
 * saving a provider nobody can actually use was the most reachable dead end
 * in the old dialog. The same completion step is offered inside a passing
 * connection test, so setup reads connect → test → enable.
 */
import { useEffect, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import type { IdentityProviderId } from '@quackback/ids'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { BackLink } from '@/components/ui/back-link'
import { IdpLogo } from '@/components/icons/idp-provider-icons'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { inferIdpKind, IDP_KIND_NAMES } from '../idp-shortcuts'
import { countEnabledAuthMethods } from '../auth-method-count'
import { SsoTestSignInProvider } from '../sso/use-sso-test-sign-in'
import { ConnectionCard } from './connection-card'
import { ProviderMenu } from './provider-menu'
import { SignInCard } from './sign-in-card'
import { UserDetailsCard } from './user-details-card'
import { identityMappingIssue, isOnlyWorkingMethod, SIGN_IN_TAB } from './provider-shared'
import { useConnectionTest } from './use-connection-test'
import { useProviderSave } from './use-provider-save'

export function ProviderDetailPage({
  providerId,
  autoTest = false,
  onAutoTestConsumed,
}: {
  providerId: IdentityProviderId
  /** Open the connection test on arrival — set by "Save and test". */
  autoTest?: boolean
  onAutoTestConsumed?: () => void
}) {
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
      <ProviderDetailBody
        provider={provider}
        autoTest={autoTest}
        onAutoTestConsumed={onAutoTestConsumed}
      />
    </SsoTestSignInProvider>
  )
}

function ProviderDetailBody({
  provider,
  autoTest,
  onAutoTestConsumed,
}: {
  provider: IdentityProvider
  autoTest: boolean
  onAutoTestConsumed?: () => void
}) {
  const enabledMethodCount = useEnabledMethodCount()
  const isOnlyMethod = isOnlyWorkingMethod(provider, enabledMethodCount)
  useAutoTest(provider, autoTest, onAutoTestConsumed)

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink {...SIGN_IN_TAB}>Sign-in</BackLink>
      <ProviderHeader provider={provider} isOnlyMethod={isOnlyMethod} />
      <ConnectionCard provider={provider} />
      <SignInCard provider={provider} />
      <UserDetailsCard provider={provider} />
    </div>
  )
}

/** Runs the connection test once when the page is opened with `?test=1`,
 *  then asks the route to drop the flag so a reload does not re-open it. */
function useAutoTest(provider: IdentityProvider, autoTest: boolean, consumed?: () => void) {
  const { openTest } = useConnectionTest(provider)
  // The ref, not the dependency list, guards the single run: `openTest` is
  // rebuilt every render and must not re-trigger the test.
  const fired = useRef(false)
  useEffect(() => {
    if (!autoTest || fired.current) return
    fired.current = true
    openTest()
    consumed?.()
  }, [autoTest, openTest, consumed])
}

/**
 * Working sign-in methods across every surface. The "keep at least one method
 * enabled" guard spans built-in email, social OAuth and the identity_provider
 * table, so the enable toggle and Remove both need the whole count, not just
 * this provider's state.
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
    const ok = await save({ enabled: checked }, checked ? 'Sign-in enabled.' : 'Sign-in disabled.')
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
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-lg font-semibold">{provider.label}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span>{IDP_KIND_NAMES[kind]}</span>
            {!provider.configured && (
              <Badge size="sm" shape="pill" variant="outline">
                No client secret
              </Badge>
            )}
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

      <div className="flex shrink-0 items-center gap-2">
        <label
          className="flex items-center gap-2 text-sm"
          title={isOnlyMethod ? 'At least one sign-in method must stay enabled.' : undefined}
        >
          <span className="text-muted-foreground">{enabled ? 'Enabled' : 'Disabled'}</span>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void toggle(v)}
            disabled={saving || isOnlyMethod}
            aria-label={`Enable ${provider.label}`}
          />
        </label>
        <ProviderMenu provider={provider} isOnlyMethod={isOnlyMethod} />
      </div>
    </div>
  )
}
