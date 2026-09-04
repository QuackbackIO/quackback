/**
 * #signin — who gets sent here, and whether a button says so.
 *
 * Verified domains (and their per-domain SSO enforcement) save themselves
 * through their own server functions, so this card's Save covers only the
 * visibility choice.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { DomainsSection } from './domains-section'
import { IdentityProviderLogoUploader } from './identity-provider-logo-uploader'
import { useProviderSave } from './use-provider-save'

export function SignInCard({ provider }: { provider: IdentityProvider }) {
  const { saving, save } = useProviderSave(provider)
  // New providers default to showing a button (reachable out of the box); the
  // admin can untick to hide. Existing providers keep their stored choice.
  const [showButton, setShowButton] = useState(provider.showButton)

  const hasVerifiedDomain = provider.domains.some((d) => d.verifiedAt)

  return (
    <div id="signin" className="scroll-mt-6">
      <SettingsCard
        title="Sign-in"
        description="Who is routed to this provider, and whether it shows a public button."
        contentClassName="space-y-6"
      >
        <DomainsSection provider={provider} disabled={saving} />

        {/* Logo — self-persisting (its own upload + save round-trip), so it sits
        outside this card's "Save sign-in" like DomainsSection does. */}
        <div className="space-y-2 border-t border-border/40 pt-5">
          <Label className="font-medium">Logo</Label>
          <IdentityProviderLogoUploader provider={provider} />
        </div>

        {/* Visibility — the single switch for whether this provider shows a
        public sign-in button. Off hides it: a routed provider (verified
        domain) stays email-routed only; a domain-less provider is parked
        until the toggle is turned back on. */}
        <div className="space-y-2 border-t border-border/40 pt-5">
          <Label className="font-medium">Visibility</Label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={showButton}
              onCheckedChange={(v) => setShowButton(v === true)}
              disabled={saving}
              aria-label="Show a sign-in button"
              className="mt-0.5"
            />
            <span>
              Show a &ldquo;Sign in with {provider.label.trim() || 'this provider'}&rdquo; button
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {hasVerifiedDomain
                  ? 'Off keeps it email-routed only: people at a verified domain are sent here, with no public button.'
                  : 'Off hides it from the sign-in screen entirely.'}
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end border-t border-border/40 pt-5">
          <Button
            type="button"
            size="sm"
            onClick={() => void save({ showButton }, 'Sign-in settings saved.')}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save sign-in'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
