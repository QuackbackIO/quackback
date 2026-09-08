/**
 * Connect single sign-on — deliberately the short page: connect, test, enable.
 *
 * Everything here is something you can only answer BEFORE the provider
 * exists: which IdP family it is, where its discovery document lives, and the
 * client credentials it issued you. Domains, provisioning, user details and
 * the connection test all need a saved row, so they live on the detail page
 * this hands off to.
 *
 * The redirect URI sits ABOVE the credential fields on purpose: you paste it
 * into the IdP and the IdP gives you the client ID and secret in return.
 *
 * "Save and test" saves the connection and credentials first, then opens the
 * test against that saved configuration on the detail page. A passing test
 * offers Enable sign-in there, so setup has a clear completion point.
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
import { IDP_KIND_NAMES } from '../idp-shortcuts'
import {
  ConnectionFields,
  connectionPatchFrom,
  emptyConnectionDraft,
  type ConnectionDraft,
} from './connection-form'
import {
  IDENTITY_PROVIDERS_KEY,
  newRegistrationId,
  reportMissingIdpFields,
  SIGN_IN_TAB,
} from './provider-shared'

export function ProviderCreatePage({
  registrationId: initialRegistrationId,
}: {
  /** Supplied by the route loader so SSR and hydration render the same
   *  redirect URI. Generated here only when rendered outside the route. */
  registrationId?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const upsert = useServerFn(upsertIdentityProviderFn)
  const setCreds = useServerFn(setProviderCredentialsFn)
  const { baseUrl } = useRouteContext({ from: '__root__' })

  // Fixed for the life of the form so the redirect URI shown below is the
  // exact value that gets saved (and registered at the IdP), even if the
  // loader re-runs.
  const [registrationId] = useState(() => initialRegistrationId ?? newRegistrationId())
  const [draft, setDraft] = useState<ConnectionDraft>(emptyConnectionDraft)
  // The provider supplies the display name; an admin can override it under
  // Connection options. Blank falls back to the provider name at save time.
  const [labelOverride, setLabelOverride] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const defaultLabel = IDP_KIND_NAMES[draft.kind]
  const label = labelOverride ?? defaultLabel

  const handleSaveAndTest = async () => {
    if (reportMissingIdpFields({ clientId: draft.clientId })) return
    setSaving(true)
    let saved: { id: string } | null = null
    try {
      saved = await upsert({
        data: {
          registrationId,
          label: label.trim() || defaultLabel,
          ...connectionPatchFrom(draft),
        },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the identity provider.')
      setSaving(false)
      return
    }
    // Only test a configuration that was fully saved: a failed secret write
    // leaves the row in place but sends the admin to the page without a test.
    let credentialsSaved = !draft.secret.trim()
    if (!credentialsSaved) {
      try {
        await setCreds({ data: { id: saved.id, clientSecret: draft.secret.trim() } })
        credentialsSaved = true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the client secret.')
      }
    }
    await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
    toast.success('Connection saved.')
    await navigate({
      to: '/admin/settings/security/sso/$providerId',
      params: { providerId: saved.id },
      search: credentialsSaved && draft.secret.trim() ? { test: true } : {},
    })
  }

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink {...SIGN_IN_TAB}>Sign-in</BackLink>

      <PageHeader
        title="Connect single sign-on"
        description="Connect an OpenID Connect provider, test it, then enable sign-in."
      />

      <SettingsCard contentClassName="space-y-6">
        <ConnectionFields
          draft={draft}
          onChange={setDraft}
          registrationId={registrationId}
          baseUrl={baseUrl}
          disabled={saving}
          existing={false}
          optionsChildren={
            <div className="space-y-2">
              <Label htmlFor="idp-label">Display name</Label>
              <Input
                id="idp-label"
                value={label}
                onChange={(e) => setLabelOverride(e.target.value)}
                placeholder={defaultLabel}
                disabled={saving}
              />
              <p className="text-sm text-muted-foreground">
                The sign-in button reads &ldquo;Sign in with {label.trim() || defaultLabel}&rdquo;.
              </p>
            </div>
          }
        />

        <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-5">
          <Button type="button" variant="outline" size="sm" asChild disabled={saving}>
            <Link {...SIGN_IN_TAB}>Cancel</Link>
          </Button>
          <Button type="button" size="sm" onClick={handleSaveAndTest} disabled={saving}>
            {saving ? 'Saving…' : 'Save and test'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
