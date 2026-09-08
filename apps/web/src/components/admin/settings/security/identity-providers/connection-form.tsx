/**
 * The connection form shared by "Connect single sign-on" and the Edit state of
 * an existing connection: provider, its one or two provider-specific inputs,
 * the redirect URI to register, the client credentials, and a collapsed
 * Connection options disclosure for everything standard providers never need.
 *
 * The parent owns the draft so it can decide what a save means (create a row
 * vs. patch one) and what happens afterwards (navigate, run the test). This
 * component only renders and validates.
 */
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { IdpLogo } from '@/components/icons/idp-provider-icons'
import { effectiveScopes, normalizeScopesInput } from '@/lib/shared/oidc-scopes'
import {
  DEFAULT_OIDC_PROMPT,
  DEFAULT_TOKEN_AUTH_METHOD,
  normalizePromptInput,
  normalizeTokenAuthInput,
} from '@/lib/shared/oidc-request'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { IDP_KIND_NAMES, inferIdpKind, type IdpKind } from '../idp-shortcuts'
import { ConnectionOptions } from './connection-options'
import {
  EMPTY_MANUAL_ENDPOINTS,
  IdpDiscoveryFields,
  type ManualEndpoints,
} from './idp-discovery-fields'
import { ProviderKindPicker } from './provider-kind-picker'
import { RedirectUriCallout } from './redirect-uri-callout'
import { redirectUriFor } from './provider-shared'
import type { ProviderPatch } from './use-provider-save'

export type ConnectionDraft = {
  kind: IdpKind
  discoveryUrl: string
  clientId: string
  /** Typed secret. Empty means "keep the saved one" on an existing provider. */
  secret: string
  scopes: string[]
  prompt: string
  tokenAuth: string
  manual: ManualEndpoints
}

export function emptyConnectionDraft(): ConnectionDraft {
  return {
    kind: inferIdpKind(null),
    discoveryUrl: '',
    clientId: '',
    secret: '',
    scopes: effectiveScopes({ scopes: null }),
    prompt: DEFAULT_OIDC_PROMPT,
    tokenAuth: DEFAULT_TOKEN_AUTH_METHOD,
    manual: { ...EMPTY_MANUAL_ENDPOINTS },
  }
}

export function connectionDraftFrom(provider: IdentityProvider): ConnectionDraft {
  return {
    // Prefer the persisted family; infer from the discovery URL only for
    // legacy rows saved before `kind` was stored.
    kind: provider.kind ?? inferIdpKind(provider.discoveryUrl),
    discoveryUrl: provider.discoveryUrl ?? '',
    clientId: provider.clientId,
    secret: '',
    // Prefilled with the EFFECTIVE set so an admin can see what is requested;
    // `normalizeScopesInput` puts null back when it still equals the defaults.
    scopes: effectiveScopes({ scopes: provider.scopes ?? null }),
    prompt: provider.prompt ?? DEFAULT_OIDC_PROMPT,
    tokenAuth: provider.tokenEndpointAuthMethod ?? DEFAULT_TOKEN_AUTH_METHOD,
    manual: {
      authorizationUrl: provider.authorizationUrl ?? '',
      tokenUrl: provider.tokenUrl ?? '',
      userInfoUrl: provider.userInfoUrl ?? '',
      jwksUri: provider.jwksUri ?? '',
      issuer: provider.issuer ?? '',
    },
  }
}

/** The upsert fields a connection draft owns. Manual endpoints only apply to
 *  "other"; they are nulled otherwise so switching back to a shortcut kind
 *  clears stale manual config. */
export type ConnectionPatch = ProviderPatch & { kind: IdpKind; clientId: string }

export function connectionPatchFrom(draft: ConnectionDraft): ConnectionPatch {
  const manual = draft.kind === 'other'
  const orNull = (value: string) => value.trim() || null
  return {
    kind: draft.kind,
    clientId: draft.clientId.trim(),
    discoveryUrl: orNull(draft.discoveryUrl),
    scopes: normalizeScopesInput(draft.scopes),
    prompt: normalizePromptInput(draft.prompt),
    tokenEndpointAuthMethod: normalizeTokenAuthInput(draft.tokenAuth),
    authorizationUrl: manual ? orNull(draft.manual.authorizationUrl) : null,
    tokenUrl: manual ? orNull(draft.manual.tokenUrl) : null,
    userInfoUrl: manual ? orNull(draft.manual.userInfoUrl) : null,
    jwksUri: manual ? orNull(draft.manual.jwksUri) : null,
    issuer: manual ? orNull(draft.manual.issuer) : null,
  }
}

export function ConnectionFields({
  draft,
  onChange,
  registrationId,
  baseUrl,
  disabled,
  existing,
  optionsChildren,
}: {
  draft: ConnectionDraft
  onChange: (next: ConnectionDraft) => void
  registrationId: string
  baseUrl: string | undefined
  disabled: boolean
  /** True on the detail page: the provider is shown as a summary with a Change
   *  action and the secret field explains that blank keeps the saved one. */
  existing: boolean
  optionsChildren?: React.ReactNode
}) {
  const [changingKind, setChangingKind] = useState(!existing)
  const patch = (p: Partial<ConnectionDraft>) => onChange({ ...draft, ...p })

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label>Provider</Label>
        {changingKind ? (
          <ProviderKindPicker
            kind={draft.kind}
            disabled={disabled}
            onKindChange={(kind, discoveryUrl) =>
              patch(discoveryUrl ? { kind, discoveryUrl } : { kind })
            }
          />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <IdpLogo
                kind={draft.kind}
                className="h-8 w-8 shrink-0"
                iconClassName="h-[18px] w-[18px]"
              />
              <span className="truncate text-sm font-medium">{IDP_KIND_NAMES[draft.kind]}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setChangingKind(true)}
            >
              Change
            </Button>
          </div>
        )}
        <IdpDiscoveryFields
          kind={draft.kind}
          discoveryUrl={draft.discoveryUrl}
          disabled={disabled}
          onChange={(discoveryUrl) => patch({ discoveryUrl })}
        />
      </div>

      {/* Register this first, then read the credentials the IdP hands back
          into the two fields below it. */}
      <RedirectUriCallout uri={redirectUriFor(baseUrl, registrationId)} />

      <div className="space-y-2">
        <Label htmlFor="idp-client-id">Client ID</Label>
        <Input
          id="idp-client-id"
          value={draft.clientId}
          onChange={(e) => patch({ clientId: e.target.value })}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="idp-client-secret">Client secret</Label>
        <Input
          id="idp-client-secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft.secret}
          onChange={(e) => patch({ secret: e.target.value })}
          placeholder={existing ? 'Leave blank to keep the current secret' : undefined}
          disabled={disabled}
        />
      </div>

      <ConnectionOptions
        kind={draft.kind}
        scopes={draft.scopes}
        prompt={draft.prompt}
        tokenAuth={draft.tokenAuth}
        discoveryUrl={draft.discoveryUrl}
        manual={draft.manual}
        disabled={disabled}
        onScopesChange={(scopes) => patch({ scopes })}
        onPromptChange={(prompt) => patch({ prompt })}
        onTokenAuthChange={(tokenAuth) => patch({ tokenAuth })}
        onManualChange={(m) => patch({ manual: { ...draft.manual, ...m } })}
      >
        {optionsChildren}
      </ConnectionOptions>
    </div>
  )
}
