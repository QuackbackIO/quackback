/**
 * Add identity provider — deliberately the short page.
 *
 * Everything here is something you can only answer BEFORE the provider
 * exists: what to call it, which IdP family it is, where its discovery
 * document lives, and the client credentials it issued you. Domains,
 * enforcement, provisioning, claim mapping and the connection test all need a
 * saved row (or a registered redirect URI) to mean anything, so they live on
 * the detail page this hands off to.
 *
 * The redirect URI sits ABOVE the credential fields on purpose: you paste it
 * into the IdP and the IdP gives you the client ID and secret in return.
 * Presenting it after them is how `redirect_uri_mismatch` gets discovered on
 * the first real sign-in instead of during setup.
 */
import { useState } from 'react'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { setProviderCredentialsFn, upsertIdentityProviderFn } from '@/lib/server/functions/sso'
import { inferIdpKind, type IdpKind } from '../idp-shortcuts'
import { IdpDiscoveryFields } from './idp-discovery-fields'
import { ProviderKindPicker } from './provider-kind-picker'
import { RedirectUriCallout } from './redirect-uri-callout'
import {
  IDENTITY_PROVIDERS_KEY,
  newRegistrationId,
  redirectUriFor,
  reportMissingIdpFields,
  SIGN_IN_TAB,
} from './provider-shared'

export function ProviderCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const upsert = useServerFn(upsertIdentityProviderFn)
  const setCreds = useServerFn(setProviderCredentialsFn)
  const { baseUrl } = useRouteContext({ from: '__root__' })

  // Generated once so the redirect URI shown below is the exact value that
  // gets saved (and registered at the IdP), not a placeholder.
  const [registrationId] = useState(newRegistrationId)

  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<IdpKind>(() => inferIdpKind(null))
  const [discoveryUrl, setDiscoveryUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [secretDraft, setSecretDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (reportMissingIdpFields(label, clientId)) return
    setSaving(true)
    try {
      const saved = await upsert({
        data: {
          registrationId,
          label: label.trim(),
          kind,
          clientId: clientId.trim(),
          discoveryUrl: discoveryUrl.trim() || null,
        },
      })
      if (secretDraft.trim()) {
        await setCreds({ data: { id: saved.id, clientSecret: secretDraft.trim() } })
      }
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success('Identity provider created.')
      await navigate({
        to: '/admin/settings/security/sso/$providerId',
        params: { providerId: saved.id },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the identity provider.')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink {...SIGN_IN_TAB}>Sign-in</BackLink>

      <PageHeader
        title="Add identity provider"
        description="Connect an OpenID Connect IdP for portal and admin sign-in."
      />

      <SettingsCard contentClassName="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="idp-label">Display name</Label>
          <Input
            id="idp-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Acme SSO"
            disabled={saving}
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
            disabled={saving}
            onKindChange={setKind}
            onDiscoveryUrlChange={setDiscoveryUrl}
          />
          <IdpDiscoveryFields
            kind={kind}
            discoveryUrl={discoveryUrl}
            disabled={saving}
            onChange={setDiscoveryUrl}
          />
        </div>

        {/* Register this first, then read the credentials the IdP hands back
            into the two fields below it. */}
        <RedirectUriCallout uri={redirectUriFor(baseUrl, registrationId)} />

        <div className="space-y-2">
          <Label htmlFor="idp-client-id">Client ID</Label>
          <Input
            id="idp-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={saving}
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
            disabled={saving}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-5">
          <Button type="button" variant="outline" size="sm" asChild disabled={saving}>
            <Link {...SIGN_IN_TAB}>Cancel</Link>
          </Button>
          <Button type="button" size="sm" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create provider'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
