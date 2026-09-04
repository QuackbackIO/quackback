/**
 * #mapping — how Quackback reads this provider's claims.
 *
 * A card of its own, NOT a section nested under auto-create. Identity
 * resolution runs on every sign-in, including for people who already have
 * accounts, so packaging it under "create accounts for new people" would hide
 * a live control from exactly the workspaces most likely to need it.
 *
 * It writes three sections of the shared `claim_mapping` column (`profile`,
 * `role`, and `attributes`) through `mergeClaimMapping`, which carries the
 * parts of `profile` that have no UI through verbatim.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { ClaimMappingEditor } from './claim-mapping-editor'
import { ClaimAttributeMappingEditor } from './claim-attribute-mapping-editor'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'
import {
  mergeClaimMapping,
  normalizeAttributeMapping,
  normalizeRoleMapping,
  withAllowMissingEmail,
  type AttributeMapping,
  type RoleMapping,
} from './provider-shared'
import { useProviderSave } from './use-provider-save'

export function ClaimMappingCard({ provider }: { provider: IdentityProvider }) {
  const { saving, save } = useProviderSave(provider)
  const [mapping, setMapping] = useState<RoleMapping | null>(provider.claimMapping?.role ?? null)
  const [attributes, setAttributes] = useState<AttributeMapping | null>(
    provider.claimMapping?.attributes ?? null
  )
  const [allowMissingEmail, setAllowMissingEmail] = useState(
    provider.claimMapping?.profile?.allowMissingEmail === true
  )
  const { lastSuccess } = useSsoTestSignIn()
  // In-session lastSuccess is the test that just completed; the persisted
  // capture is only reloaded with the provider row. Prefer the session copy
  // so suggestions and preview update without a refresh.
  const capture =
    lastSuccess && lastSuccess.registrationId === provider.registrationId
      ? lastSuccess
      : provider.lastTestCapture &&
          provider.lastTestCapture.registrationId === provider.registrationId
        ? provider.lastTestCapture
        : null

  const handleSave = () =>
    void save(
      {
        claimMapping: mergeClaimMapping(provider.claimMapping, {
          role: normalizeRoleMapping(mapping),
          profile: withAllowMissingEmail(provider.claimMapping?.profile, allowMissingEmail),
          attributes: normalizeAttributeMapping(attributes),
        }),
      },
      'Claim mapping saved.'
    )

  return (
    <div id="mapping" className="scroll-mt-6">
      <SettingsCard
        title="Claim mapping"
        description="How Quackback reads this provider. Applies on every sign-in, including for people who already have accounts."
        contentClassName="space-y-4"
      >
        {/* Identity fields. Off by default and one-way: minting stores the
        address permanently, so turning this back off later does not convert
        accounts that already have one. */}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={allowMissingEmail}
            onCheckedChange={(v) => setAllowMissingEmail(v === true)}
            disabled={saving}
            aria-label="Allow accounts without an email address"
            className="mt-0.5"
          />
          <span>
            Allow accounts without an email address
            <span className="mt-0.5 block text-xs text-muted-foreground">
              For providers that release no email. Quackback creates a placeholder so people can
              still sign in, then asks them for a real address afterwards. Placeholders are
              permanent: turning this off later does not convert accounts that already have one.
              Off, these people cannot sign in at all.
            </span>
          </span>
        </label>

        <ClaimMappingEditor
          mapping={mapping}
          disabled={saving}
          registrationId={provider.registrationId}
          canTest
          onChange={setMapping}
        />

        <ClaimAttributeMappingEditor
          mapping={attributes}
          disabled={saving}
          registrationId={provider.registrationId}
          canTest
          capture={capture}
          detailsChangedAt={provider.detailsChangedAt}
          onChange={setAttributes}
        />

        <div className="flex justify-end border-t border-border/40 pt-5">
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save claim mapping'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
