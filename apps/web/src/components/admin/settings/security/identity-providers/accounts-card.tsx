/**
 * #accounts — what happens the first time someone arrives through this
 * provider without an account.
 *
 * The default role is the one setting that is genuinely creation-only, so it
 * is the one setting that belongs under the auto-create toggle. Claim mapping
 * does not: it runs on every sign-in, so it is its own card.
 */
import { useState } from 'react'
import type { Role } from '@/lib/shared/roles'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { useProviderSave } from './use-provider-save'

export function AccountsCard({ provider }: { provider: IdentityProvider }) {
  const { saving, save } = useProviderSave(provider)
  const [autoCreateUsers, setAutoCreateUsers] = useState(provider.autoCreateUsers)
  const [autoProvisionRole, setAutoProvisionRole] = useState<Role>(
    provider.autoProvisionRole ?? 'user'
  )

  return (
    <div id="accounts" className="scroll-mt-6">
      <SettingsCard
        title="Accounts"
        description="What happens when someone signs in through this provider for the first time."
        contentClassName="space-y-6"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <Label className="font-medium">Auto-create accounts on first sign-in</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Create an account the first time someone signs in through this provider.
              </p>
            </div>
            <Switch
              checked={autoCreateUsers}
              onCheckedChange={setAutoCreateUsers}
              disabled={saving}
              aria-label="Auto-create accounts on first sign-in"
              className="mt-0.5 shrink-0"
            />
          </div>

          {/* Default role genuinely only applies to accounts being created,
          so it is the one thing that belongs under this toggle. */}
          {autoCreateUsers && (
            <div className="space-y-2">
              <Label htmlFor="idp-default-role" className="font-medium">
                Default role
              </Label>
              <Select
                value={autoProvisionRole}
                onValueChange={(r) => setAutoProvisionRole(r as Role)}
                disabled={saving}
              >
                <SelectTrigger
                  id="idp-default-role"
                  size="sm"
                  className="w-[220px]"
                  aria-label="Default role"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="user">User (portal only)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                New users get this role unless a rule in Claim mapping matches.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border/40 pt-5">
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() =>
              void save(
                {
                  autoCreateUsers,
                  // Role only applies when auto-create is on; null it out
                  // otherwise so a stale role doesn't linger on a
                  // provisioning-off provider.
                  autoProvisionRole: autoCreateUsers ? autoProvisionRole : null,
                },
                'Account settings saved.'
              )
            }
          >
            {saving ? 'Saving…' : 'Save accounts'}
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}
