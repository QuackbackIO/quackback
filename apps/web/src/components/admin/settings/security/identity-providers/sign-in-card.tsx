/**
 * Sign-in & access — the access decisions an admin makes on purpose: whether
 * the provider shows a button, whether first sign-in creates an account and
 * with which role, which domains route here, and whether those domains must
 * use SSO. None of these are inferred; a mis-set access rule is worse than an
 * extra switch.
 *
 * Domains save themselves (verification and enforcement are immediate,
 * server-checked actions); everything else here saves together.
 *
 * Two things are behind disclosures because most workspaces never touch them:
 * Sign-in appearance (display name and logo, both prefilled from the provider)
 * and Account options (signing in without an email address).
 */
import { useState } from 'react'
import type { Role } from '@/lib/shared/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { allowsMissingEmail } from '@/lib/shared/oidc-claim-mapping'
import { diffClaimMappingOperations, mappingSaveRisks } from '@/lib/shared/sso-claim-mapping-edit'
import { Disclosure } from './disclosure'
import { DomainsSection } from './domains-section'
import { IdentityProviderLogoUploader } from './identity-provider-logo-uploader'
import { mergeClaimMapping, reportMissingIdpFields, withAllowMissingEmail } from './provider-shared'
import { useProviderSave } from './use-provider-save'
import type { ProviderPatch } from './use-provider-save'

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  member: 'Member',
  user: 'User (portal only)',
}

export function SignInCard({ provider }: { provider: IdentityProvider }) {
  const { saving, save, saveClaimMapping } = useProviderSave(provider)
  const [showButton, setShowButton] = useState(provider.showButton)
  const [label, setLabel] = useState(provider.label)
  const [autoCreateUsers, setAutoCreateUsers] = useState(provider.autoCreateUsers)
  const [autoProvisionRole, setAutoProvisionRole] = useState<Role>(
    provider.autoProvisionRole ?? 'user'
  )
  const storedAllowMissingEmail = allowsMissingEmail(provider.claimMapping)
  const [allowMissingEmail, setAllowMissingEmail] = useState(storedAllowMissingEmail)

  const patch: ProviderPatch = {
    showButton,
    label: label.trim(),
    autoCreateUsers,
    // Role only applies when creation is on; null it out otherwise so a stale
    // role does not linger on a provider that no longer creates accounts.
    autoProvisionRole: autoCreateUsers ? autoProvisionRole : null,
  }
  const dirty =
    showButton !== provider.showButton ||
    label.trim() !== provider.label ||
    autoCreateUsers !== provider.autoCreateUsers ||
    (autoCreateUsers && autoProvisionRole !== (provider.autoProvisionRole ?? 'user')) ||
    allowMissingEmail !== storedAllowMissingEmail

  const handleSave = async () => {
    if (reportMissingIdpFields({ label })) return
    const ok = await save(patch, 'Sign-in settings saved.')
    if (!ok || allowMissingEmail === storedAllowMissingEmail) return
    // The missing-email policy lives in claim_mapping, so it is a second,
    // ops-based write. Existing admin rules are untouched by it, which is why
    // they are acknowledged rather than re-confirmed here.
    const proposed = mergeClaimMapping(provider.claimMapping, {
      profile: withAllowMissingEmail(provider.claimMapping?.profile, allowMissingEmail),
    })
    await saveClaimMapping(
      {
        operations: diffClaimMappingOperations(provider.claimMapping, proposed),
        acknowledgeAdminRules: mappingSaveRisks(provider.claimMapping, proposed).hasAdminRules,
      },
      'Sign-in settings saved.'
    )
  }

  return (
    <div id="signin" className="scroll-mt-6">
      <SettingsCard title="Sign-in & access" contentClassName="space-y-6">
        <div className="space-y-4">
          <SwitchRow
            label="Show sign-in button"
            checked={showButton}
            onChange={setShowButton}
            disabled={saving}
          >
            {!showButton && provider.domains.some((d) => d.verifiedAt) && (
              <p className="text-sm text-muted-foreground">
                People at a verified domain are still sent here from the email step.
              </p>
            )}
          </SwitchRow>

          <Disclosure
            title="Sign-in appearance"
            summary={label.trim() ? `Sign in with ${label.trim()}` : undefined}
          >
            <div className="space-y-2">
              <Label htmlFor="idp-label">Display name</Label>
              <Input
                id="idp-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={saving}
              />
              <p className="text-sm text-muted-foreground">
                The button reads &ldquo;Sign in with {label.trim() || provider.label}&rdquo;.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Logo</Label>
              <IdentityProviderLogoUploader provider={provider} />
            </div>
          </Disclosure>
        </div>

        <div className="space-y-4 border-t border-border/40 pt-5">
          <SwitchRow
            label="Create accounts on first sign-in"
            checked={autoCreateUsers}
            onChange={setAutoCreateUsers}
            disabled={saving}
          />
          {autoCreateUsers && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label htmlFor="idp-default-role">New account role</Label>
              <Select
                value={autoProvisionRole}
                onValueChange={(r) => setAutoProvisionRole(r as Role)}
                disabled={saving}
              >
                <SelectTrigger
                  id="idp-default-role"
                  size="sm"
                  className="w-[220px]"
                  aria-label="New account role"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="border-t border-border/40 pt-5">
          <DomainsSection provider={provider} disabled={saving} />
        </div>

        <Disclosure
          title="Account options"
          defaultOpen={storedAllowMissingEmail}
          summary={allowMissingEmail ? 'Sign-in without email allowed' : undefined}
        >
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={allowMissingEmail}
              onCheckedChange={(v) => setAllowMissingEmail(v === true)}
              disabled={saving}
              aria-label="Let people sign in without an email address"
              className="mt-0.5"
            />
            <span>
              Let people sign in without an email address
              {allowMissingEmail && (
                <span className="mt-1 block text-muted-foreground">
                  They get a permanent placeholder address and are asked for a real one afterwards.
                  Turning this off later does not change accounts that already have a placeholder.
                </span>
              )}
            </span>
          </label>
        </Disclosure>

        <div className="flex justify-end border-t border-border/40 pt-5">
          <Button type="button" size="sm" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <Label className="font-medium">{label}</Label>
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-label={label}
          className="shrink-0"
        />
      </div>
      {children}
    </div>
  )
}
