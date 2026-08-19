/**
 * #connection — how Quackback reaches the IdP: its name, family, discovery (or
 * manual endpoints), credentials, the authorize-request options, the redirect
 * URI to register, and the test that proves the whole lot works.
 *
 * The required fields both live here, so a failed save can simply scroll to
 * the offending input and focus it. That is the whole reason the tabbed dialog
 * needed tab routing on validation failure and a page does not.
 */
import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { effectiveScopes, normalizeScopesInput } from '@/lib/shared/oidc-scopes'
import {
  DEFAULT_OIDC_PROMPT,
  DEFAULT_TOKEN_AUTH_METHOD,
  normalizePromptInput,
  normalizeTokenAuthInput,
} from '@/lib/shared/oidc-request'
import { setProviderCredentialsFn } from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { inferIdpKind, type IdpKind } from '../idp-shortcuts'
import { AdvancedSection } from './advanced-section'
import { ConnectionTestRow } from './connection-test-row'
import { IdpDiscoveryFields, ManualEndpointsSection } from './idp-discovery-fields'
import { ProviderKindPicker } from './provider-kind-picker'
import { RedirectUriCallout } from './redirect-uri-callout'
import { redirectUriFor, reportMissingIdpFields } from './provider-shared'
import { useProviderSave } from './use-provider-save'

export function ConnectionCard({ provider }: { provider: IdentityProvider }) {
  const { baseUrl } = useRouteContext({ from: '__root__' })
  const setCreds = useServerFn(setProviderCredentialsFn)
  const { saving, save } = useProviderSave(provider)

  const [label, setLabel] = useState(provider.label)
  // Prefer the persisted shortcut choice; fall back to inferring it from the
  // discovery URL only for legacy rows saved before `kind` was stored (a
  // vanity domain infers as "Custom OIDC" even when it is really Okta/Entra).
  const [kind, setKind] = useState<IdpKind>(
    () => provider.kind ?? inferIdpKind(provider.discoveryUrl)
  )
  const [discoveryUrl, setDiscoveryUrl] = useState(provider.discoveryUrl ?? '')
  // Manual endpoints for an IdP with no discovery document. authorization +
  // token are needed to sign in; jwks + issuer additionally let the SSO test
  // verify the ID token (and thus unlock enforcement). Only surfaced for the
  // "Other" kind — the shortcut kinds always build a discovery URL.
  const [manual, setManual] = useState({
    authorizationUrl: provider.authorizationUrl ?? '',
    tokenUrl: provider.tokenUrl ?? '',
    userInfoUrl: provider.userInfoUrl ?? '',
    jwksUri: provider.jwksUri ?? '',
    issuer: provider.issuer ?? '',
  })
  // Prefilled with the EFFECTIVE set, not an empty field. The reported failure
  // was an admin unable to see what was being requested, so a blank input
  // showing the defaults as placeholder text would reproduce the same problem.
  // `normalizeScopesInput` puts null back when the set still equals the
  // defaults, so prefilling does not rewrite an untouched provider.
  const [scopes, setScopes] = useState<string[]>(() =>
    effectiveScopes({ scopes: provider.scopes ?? null })
  )
  const [prompt, setPrompt] = useState<string>(provider.prompt ?? DEFAULT_OIDC_PROMPT)
  const [tokenAuth, setTokenAuth] = useState<string>(
    provider.tokenEndpointAuthMethod ?? DEFAULT_TOKEN_AUTH_METHOD
  )
  const [clientId, setClientId] = useState(provider.clientId)
  const [secretDraft, setSecretDraft] = useState('')
  const [savingSecret, setSavingSecret] = useState(false)

  const busy = saving || savingSecret

  const handleSave = async () => {
    if (reportMissingIdpFields(label, clientId)) return
    const ok = await save({
      label: label.trim(),
      // Persist the selected family so the page reopens on the right tile
      // regardless of what the discovery URL would infer.
      kind,
      clientId: clientId.trim(),
      discoveryUrl: discoveryUrl.trim() || null,
      scopes: normalizeScopesInput(scopes),
      prompt: normalizePromptInput(prompt),
      tokenEndpointAuthMethod: normalizeTokenAuthInput(tokenAuth),
      // Manual endpoints only apply to "Other"; null them out otherwise so
      // switching back to a shortcut kind clears any stale manual config.
      authorizationUrl: kind === 'other' ? manual.authorizationUrl.trim() || null : null,
      tokenUrl: kind === 'other' ? manual.tokenUrl.trim() || null : null,
      userInfoUrl: kind === 'other' ? manual.userInfoUrl.trim() || null : null,
      jwksUri: kind === 'other' ? manual.jwksUri.trim() || null : null,
      issuer: kind === 'other' ? manual.issuer.trim() || null : null,
    })
    if (!ok || !secretDraft.trim()) return
    setSavingSecret(true)
    try {
      await setCreds({ data: { id: provider.id, clientSecret: secretDraft.trim() } })
      setSecretDraft('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the client secret.')
    } finally {
      setSavingSecret(false)
    }
  }

  return (
    <div id="connection" className="scroll-mt-6">
      <SettingsCard
        title="Connection"
        description="How Quackback reaches your IdP."
        contentClassName="space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="idp-label">Display name</Label>
          <Input
            id="idp-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Acme SSO"
            disabled={busy}
          />
          {label.trim() && (
            <p className="text-xs text-muted-foreground">
              Button reads: &ldquo;Sign in with {label.trim()}&rdquo;
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Label>Identity provider</Label>
          <ProviderKindPicker
            kind={kind}
            disabled={busy}
            onKindChange={setKind}
            onDiscoveryUrlChange={setDiscoveryUrl}
          />
          <IdpDiscoveryFields
            kind={kind}
            discoveryUrl={discoveryUrl}
            disabled={busy}
            onChange={setDiscoveryUrl}
          />
          {kind === 'other' && (
            <ManualEndpointsSection
              values={manual}
              disabled={busy}
              onChange={(patch) => setManual((m) => ({ ...m, ...patch }))}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="idp-client-id">Client ID</Label>
          <Input
            id="idp-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="idp-client-secret">Client secret</Label>
          <Input
            id="idp-client-secret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secretDraft}
            onChange={(e) => setSecretDraft(e.target.value)}
            placeholder="Leave blank to keep the current secret"
            disabled={busy}
          />
        </div>

        <AdvancedSection
          scopes={scopes}
          prompt={prompt}
          tokenAuth={tokenAuth}
          discoveryUrl={discoveryUrl}
          disabled={busy}
          onChange={setScopes}
          onPromptChange={setPrompt}
          onTokenAuthChange={setTokenAuth}
        />

        <RedirectUriCallout uri={redirectUriFor(baseUrl, provider.registrationId)} />

        {/* Connection test — the capstone of the connection block. A successful
        test validates discovery + credentials + the registered redirect URI,
        and is the precondition that unlocks enforcement. */}
        <ConnectionTestRow
          provider={provider}
          registrationId={provider.registrationId}
          disabled={busy}
        />

        <div className="flex justify-end border-t border-border/40 pt-5">
          <Button type="button" size="sm" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save connection'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
