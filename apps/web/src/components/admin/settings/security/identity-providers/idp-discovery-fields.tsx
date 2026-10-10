/**
 * Discovery inputs for a provider, in two parts.
 *
 * `<IdpDiscoveryFields>` is IdP-aware: per-kind shortcut fields (Okta domain,
 * Entra workspace, Keycloak base+realm) build the canonical discovery URL;
 * `other` takes the raw URL; `google` is a fixed URL with no input.
 *
 * `<ManualEndpointsFields>` is the escape hatch for an IdP with no discovery
 * document, and only ever renders for the `other` kind.
 */
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getIdpShortcut, type IdpKind } from '../idp-shortcuts'

export function IdpDiscoveryFields({
  kind,
  discoveryUrl,
  disabled,
  onChange,
}: {
  kind: IdpKind
  discoveryUrl: string
  disabled: boolean
  onChange: (url: string) => void
}) {
  const def = getIdpShortcut(kind)
  const [draft, setDraft] = useState<Record<string, string>>({})

  if (kind === 'other') {
    return (
      <div className="space-y-2">
        <Label htmlFor="idp-discovery">Discovery URL</Label>
        <Input
          id="idp-discovery"
          value={discoveryUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://your-idp/.well-known/openid-configuration"
          disabled={disabled}
        />
      </div>
    )
  }

  if (def.fields.length === 0) {
    // Google: fixed discovery URL, seeded by the kind selector. No input.
    return null
  }

  const parsed = def.parse(discoveryUrl)
  const values = parsed ?? draft
  const apply = (next: Record<string, string>) => {
    setDraft(next)
    const url = def.build(next)
    if (url) onChange(url)
  }

  return (
    <div className="space-y-3">
      {def.fields.map((f) => (
        <div key={f.key} className="space-y-2">
          <Label htmlFor={`idp-field-${f.key}`}>{f.label}</Label>
          <Input
            id={`idp-field-${f.key}`}
            value={values[f.key] ?? ''}
            onChange={(e) => apply({ ...values, [f.key]: e.target.value })}
            placeholder={f.placeholder}
            disabled={disabled}
          />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      ))}
    </div>
  )
}

export type ManualEndpoints = {
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  jwksUri: string
  issuer: string
}

export const EMPTY_MANUAL_ENDPOINTS: ManualEndpoints = {
  authorizationUrl: '',
  tokenUrl: '',
  userInfoUrl: '',
  jwksUri: '',
  issuer: '',
}

const MANUAL_FIELDS: { key: keyof ManualEndpoints; label: string; placeholder: string }[] = [
  {
    key: 'authorizationUrl',
    label: 'Authorization URL',
    placeholder: 'https://your-idp/authorize',
  },
  { key: 'tokenUrl', label: 'Token URL', placeholder: 'https://your-idp/token' },
  { key: 'jwksUri', label: 'JWKS URI', placeholder: 'https://your-idp/.well-known/jwks.json' },
  { key: 'issuer', label: 'Issuer', placeholder: 'https://your-idp/' },
  {
    key: 'userInfoUrl',
    label: 'User info URL (optional)',
    placeholder: 'https://your-idp/userinfo',
  },
]

/**
 * Manual OIDC endpoints for an IdP with no discovery document. Authorization +
 * Token are the minimum to sign in; adding JWKS URI + Issuer lets the SSO test
 * verify the ID token, which is what unlocks domain enforcement. Rendered only
 * for the `other` kind, inside Connection options.
 */
export function ManualEndpointsFields({
  values,
  disabled,
  onChange,
}: {
  values: ManualEndpoints
  disabled: boolean
  onChange: (patch: Partial<ManualEndpoints>) => void
}) {
  return (
    <div className="space-y-3">
      {MANUAL_FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label htmlFor={`idp-manual-${f.key}`} className="text-xs">
            {f.label}
          </Label>
          <Input
            id={`idp-manual-${f.key}`}
            value={values[f.key]}
            onChange={(e) => onChange({ [f.key]: e.target.value })}
            placeholder={f.placeholder}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  )
}
