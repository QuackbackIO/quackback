/**
 * Per-provider verified-domain list. A verified domain routes its users to
 * this provider and can be enforced (SSO-only for that domain).
 *
 * Enforcement is the one control here that can lock a workspace out, so it
 * stays behind three preconditions, all of which survive the move to a page:
 * the domain must be DNS-verified, the provider must carry a test sign-in
 * that postdates its last connection change, and the server refuses the write
 * until recovery codes exist (surfaced inline as `recovery_codes_required`).
 *
 * Domains save themselves through their own server functions, so this section
 * has no Save button of its own — every action here is immediate.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { CheckCircleIcon, ClockIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { WarningBox } from '@/components/shared/warning-box'
import { TimeAgo } from '@/components/ui/time-ago'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import {
  addProviderDomainFn,
  removeVerifiedDomainFn,
  setDomainEnforcedFn,
  verifyProviderDomainFn,
  type VerifyDomainResult,
} from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { IDENTITY_PROVIDERS_KEY, getConnectionTestState } from './provider-shared'

const VERIFY_REASON_MESSAGES: Record<
  Exclude<VerifyDomainResult, { verified: true }>['reason'],
  string
> = {
  'no-record':
    "Couldn't find a TXT record at that name. Add the record above and wait for DNS propagation, then try again.",
  mismatch:
    "Found a TXT record but the value didn't match. Double-check the value (it should start with `qb-domain-verify=`).",
  'lookup-failed': 'DNS lookup failed. Try again in a moment.',
  'no-pending-domain': 'No pending domain to verify.',
}

export function DomainsSection({
  provider,
  disabled,
}: {
  provider: IdentityProvider | null
  disabled: boolean
}) {
  const queryClient = useQueryClient()
  const addDomain = useServerFn(addProviderDomainFn)
  const [draftName, setDraftName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const domains = provider?.domains ?? []
  const hasVerified = domains.some((d) => d.verifiedAt)
  // Enforcement is available once the provider has a fresh test sign-in — same
  // predicate that drives the connection status line (see getConnectionTestState).
  const enforceable = getConnectionTestState(provider).kind === 'verified'

  const refresh = () => queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!provider || !draftName.trim()) return
    setAddError('')
    setAdding(true)
    try {
      await addDomain({ data: { providerId: provider.id, name: draftName.trim() } })
      await refresh()
      setDraftName('')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add domain.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="font-medium">Verified domains</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasVerified
            ? 'Users at a verified domain are routed to this provider. Enforce a domain to require its users to sign in with SSO.'
            : 'Verify a domain to route its users to this provider, and enforce SSO so they can only sign in this way.'}
        </p>
      </div>

      {!provider ? (
        <p className="rounded-md border border-dashed border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
          Save the provider first to add a domain to route or enforce by email.
        </p>
      ) : (
        <>
          {domains.length === 0 ? (
            <p className="text-xs text-muted-foreground">No domains attached.</p>
          ) : (
            <div className="divide-y divide-border/50 rounded-md border border-border/50">
              {domains.map((d) => (
                <DomainRow
                  key={d.id}
                  domain={d}
                  disabled={disabled}
                  enforceable={enforceable}
                  onChanged={refresh}
                />
              ))}
            </div>
          )}

          {hasVerified && enforceable && (
            <WarningBox
              variant="warning"
              title="Before you enforce"
              description="Run a successful test sign-in and generate recovery codes first. They're your break-glass if SSO ever breaks."
            />
          )}

          <form onSubmit={handleAdd} className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="acme.com"
                disabled={adding || disabled}
                className="h-9"
                aria-label="Add domain"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                className="h-9"
                disabled={adding || disabled || !draftName.trim()}
              >
                <PlusIcon className="mr-1 h-3.5 w-3.5" />
                {adding ? 'Adding…' : 'Add domain'}
              </Button>
            </div>
            {addError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{addError}</AlertDescription>
              </Alert>
            )}
          </form>
        </>
      )}
    </div>
  )
}

function DomainRow({
  domain,
  disabled,
  enforceable,
  onChanged,
}: {
  domain: VerifiedDomain
  disabled: boolean
  /** True when the provider has a fresh test sign-in — the enforcement
   *  checkbox is enabled. False disables the checkbox to prevent setting
   *  enforcement on an unverified connection. */
  enforceable: boolean
  onChanged: () => Promise<unknown> | void
}) {
  const verify = useServerFn(verifyProviderDomainFn)
  const setEnforced = useServerFn(setDomainEnforcedFn)
  const remove = useServerFn(removeVerifiedDomainFn)

  const [pending, setPending] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyDomainResult | null>(null)
  const [enforceError, setEnforceError] = useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const isVerified = domain.verifiedAt !== null
  const providerId = domain.providerId

  const handleRemove = async () => {
    setPending(true)
    try {
      await remove({ data: { id: domain.id } })
      await onChanged()
    } catch (err) {
      setEnforceError(err instanceof Error ? err.message : 'Could not remove domain.')
    } finally {
      setPending(false)
      setRemoveOpen(false)
    }
  }

  const handleVerify = async () => {
    if (!providerId) return
    setVerifyResult(null)
    setPending(true)
    try {
      const r = await verify({ data: { providerId, id: domain.id } })
      setVerifyResult(r)
      if (r.verified) await onChanged()
    } catch {
      setVerifyResult({ verified: false, reason: 'lookup-failed' })
    } finally {
      setPending(false)
    }
  }

  const handleEnforce = async (next: boolean) => {
    setEnforceError(null)
    setPending(true)
    try {
      await setEnforced({ data: { id: domain.id, enforced: next } })
      await onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setEnforceError(
        msg === 'recovery_codes_required'
          ? 'Generate recovery codes before enforcing SSO. They are the only break-glass way back in.'
          : msg || 'Could not update enforcement.'
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isVerified ? (
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-700 dark:text-green-400" />
          ) : (
            <ClockIcon className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          )}
          <span className="truncate text-sm font-medium">{domain.name}</span>
          <span className="text-xs text-muted-foreground">
            {isVerified ? (
              <>
                verified <TimeAgo date={domain.verifiedAt!} />
              </>
            ) : (
              'DNS pending'
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isVerified && (
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={domain.enforced}
                onCheckedChange={(v) => void handleEnforce(v === true)}
                disabled={pending || disabled || !enforceable}
                aria-label={`Require SSO for ${domain.name}`}
              />
              Enforce SSO
            </label>
          )}
          {!isVerified && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={handleVerify}
              disabled={pending || disabled}
            >
              {pending ? 'Verifying…' : 'Verify'}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => setRemoveOpen(true)}
            disabled={pending || disabled}
            aria-label={`Remove ${domain.name}`}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isVerified && (
        <div className="space-y-1 rounded bg-muted/30 p-2 text-xs text-muted-foreground">
          <p>Add this DNS TXT record, then click Verify:</p>
          <code className="block break-all">
            _quackback-verify.{domain.name} = qb-domain-verify={domain.verificationToken}
          </code>
        </div>
      )}

      {verifyResult && !verifyResult.verified && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            {VERIFY_REASON_MESSAGES[verifyResult.reason]}
          </AlertDescription>
        </Alert>
      )}
      {enforceError && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{enforceError}</AlertDescription>
        </Alert>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${isVerified ? 'verified' : 'pending'} domain?`}
        description={
          isVerified
            ? `Stops routing *@${domain.name} emails to this provider.`
            : `Discards the pending verification token for ${domain.name}.`
        }
        variant="destructive"
        confirmLabel="Remove"
        isPending={pending}
        onConfirm={handleRemove}
      />
    </div>
  )
}
