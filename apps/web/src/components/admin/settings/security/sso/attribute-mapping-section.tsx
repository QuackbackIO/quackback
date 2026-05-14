/**
 * Admin UI for IdP-attribute → role mapping.
 *
 * Single section with:
 *  - Enable/disable toggle
 *  - Claim path input (dotted or URL-shaped)
 *  - List of rules (whenContains text + role select), add/remove
 *  - Default role select
 *  - Sync-on-every-sign-in toggle (default off)
 *
 * Persists via updateAuthConfigFn with the ssoOidc.attributeMapping
 * subtree. Server side does the audit emission.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, TrashIcon, AdjustmentsHorizontalIcon } from '@heroicons/react/24/solid'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateAuthConfigFn } from '@/lib/server/functions/settings'
import type { AuthConfig } from '@/lib/shared/types/settings'

type Role = 'admin' | 'member' | 'user'
type Mapping = NonNullable<NonNullable<AuthConfig['ssoOidc']>['attributeMapping']>

const ROLES: Role[] = ['admin', 'member', 'user']

interface AttributeMappingSectionProps {
  currentMapping: Mapping | undefined
}

export function AttributeMappingSection({ currentMapping }: AttributeMappingSectionProps) {
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(!!currentMapping)
  const [claimPath, setClaimPath] = useState(currentMapping?.claimPath ?? 'groups')
  const [defaultRole, setDefaultRole] = useState<Role>(currentMapping?.defaultRole ?? 'member')
  const [syncOnEverySignIn, setSyncOnEverySignIn] = useState(
    currentMapping?.syncOnEverySignIn ?? false
  )
  const [rules, setRules] = useState<Array<{ whenContains: string; role: Role }>>(
    currentMapping?.rules ?? []
  )

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ssoOidc: {
          attributeMapping: enabled
            ? ({ claimPath, rules, defaultRole, syncOnEverySignIn } as Mapping)
            : undefined,
        },
      }
      return updateAuthConfigFn({ data: payload })
    },
    onSuccess: () => {
      toast.success(enabled ? 'Attribute mapping saved.' : 'Attribute mapping disabled.')
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save mapping.')
    },
  })

  function addRule() {
    setRules((current) => [...current, { whenContains: '', role: 'member' }])
  }
  function removeRule(index: number) {
    setRules((current) => current.filter((_, i) => i !== index))
  }
  function updateRule(index: number, patch: Partial<{ whenContains: string; role: Role }>) {
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
  }

  return (
    <section className="space-y-4 pt-6 border-t border-border/40">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <AdjustmentsHorizontalIcon className="size-4 text-muted-foreground mt-0.5" />
          <div>
            <h3 className="text-sm font-medium">Attribute mapping</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Source the user&apos;s role from an IdP claim on the ID token. Rules are
              first-match-wins.
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled ? (
        <div className="space-y-4 pl-6">
          <div className="space-y-2">
            <Label htmlFor="claim-path">Claim path</Label>
            <Input
              id="claim-path"
              value={claimPath}
              onChange={(e) => setClaimPath(e.target.value)}
              placeholder="groups, realm_access.roles, https://acme.com/roles"
            />
            <p className="text-xs text-muted-foreground">
              Dotted path or URL-shaped namespaced claim — copy-paste from your IdP&apos;s docs.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Rules</Label>
            <div className="space-y-2">
              {rules.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No rules — everyone gets the default role.
                </p>
              ) : null}
              {rules.map((rule, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">When contains</span>
                  <Input
                    value={rule.whenContains}
                    onChange={(e) => updateRule(index, { whenContains: e.target.value })}
                    placeholder="platform-admins"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">→</span>
                  <Select
                    value={rule.role}
                    onValueChange={(v) => updateRule(index, { role: v as Role })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRule(index)}
                    aria-label="Remove rule"
                    className="h-9"
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addRule} className="h-9">
                <PlusIcon className="size-3.5" />
                Add rule
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-role">Default role</Label>
            <Select value={defaultRole} onValueChange={(v) => setDefaultRole(v as Role)}>
              <SelectTrigger id="default-role" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used when no rule matches the user&apos;s claim.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs">
            <Switch
              checked={syncOnEverySignIn}
              onCheckedChange={setSyncOnEverySignIn}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Sync on every sign-in.</span> Re-resolve and apply the
              role on every successful SSO sign-in. Demotes existing team members when their IdP
              group changes.
            </span>
          </label>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save mapping'}
        </Button>
      </div>
    </section>
  )
}
