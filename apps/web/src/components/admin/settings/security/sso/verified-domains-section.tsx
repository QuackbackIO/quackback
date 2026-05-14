import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { CheckCircleIcon, ClockIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { WarningBox } from '@/components/shared/warning-box'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { CopyButton } from '@/components/shared/copy-button'
import { TimeAgo } from '@/components/ui/time-ago'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  addVerifiedDomainFn,
  removeVerifiedDomainFn,
  verifyDomainFn,
  setVerifiedDomainEnforcedFn,
  type VerifyDomainResult,
} from '@/lib/server/functions/sso'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { useSsoTestSignIn } from './use-sso-test-sign-in'

const MAX_VERIFIED_DOMAINS = 10

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

/**
 * Verified-domain list rendered as a table — replaces the old single-
 * domain UI. Each row shows status, per-row "Require SSO" toggle, and
 * actions. Pending rows expand to show DNS instructions inline.
 *
 * Self-contained data: reads `settingsQueries.verifiedDomains()` and
 * invalidates that key + `ssoStatus` after every mutation.
 */
export function VerifiedDomainsSection() {
  const domainsQuery = useSuspenseQuery(settingsQueries.verifiedDomains())
  const ssoEnabledQuery = useSuspenseQuery(settingsQueries.authConfig())
  const ssoStatusQuery = useSuspenseQuery(adminQueries.ssoStatus())
  const domains = domainsQuery.data ?? []
  const ssoEnabled = ssoEnabledQuery.data?.ssoOidc?.enabled === true
  const enforcementEligible = ssoStatusQuery.data?.enforcementEligible ?? false

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Verified domains</h3>
        <p className="text-xs text-muted-foreground">
          Add the email domains your team uses. Once verified, those emails sign in through your SSO
          provider by default. Turn on <b>Require SSO</b> to make it the only option for that
          domain.
        </p>
      </div>

      {!ssoEnabled && domains.length > 0 && (
        <WarningBox
          variant="warning"
          title="SSO is turned off"
          description={
            <>
              These domains will start using SSO once you turn on <strong>Enabled</strong> above.
            </>
          }
        />
      )}

      {/* md+: table layout */}
      <div className="hidden md:block rounded-md border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Domain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[140px]">Require SSO</TableHead>
              <TableHead className="w-[110px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">
                  No domains yet. Add one below to route those emails to SSO.
                </TableCell>
              </TableRow>
            )}
            {domains.map((d) => (
              <DomainRow key={d.id} domain={d} enforcementEligible={enforcementEligible} />
            ))}
          </TableBody>
          <TableFooter className="bg-transparent">
            <AddDomainFooter
              atCap={domains.length >= MAX_VERIFIED_DOMAINS}
              count={domains.length}
            />
          </TableFooter>
        </Table>
      </div>

      {/* below md: stacked card layout */}
      <div className="md:hidden rounded-md border border-border/50 overflow-hidden divide-y divide-border/50">
        {domains.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-6">
            No domains yet. Add one below to route those emails to SSO.
          </p>
        )}
        {domains.map((d) => (
          <DomainCard key={d.id} domain={d} enforcementEligible={enforcementEligible} />
        ))}
        <AddDomainCardRow atCap={domains.length >= MAX_VERIFIED_DOMAINS} count={domains.length} />
      </div>
    </div>
  )
}

/**
 * All the mutation logic + state for one verified-domain row, shared
 * by the desktop `DomainRow` and the mobile `DomainCard` — they differ
 * only in JSX layout. Centralising it here means the test-sign-in gate
 * on the Require SSO toggle is wired once.
 */
function useDomainEnforcement(domain: VerifiedDomain, enforcementEligible: boolean) {
  const queryClient = useQueryClient()
  const remove = useServerFn(removeVerifiedDomainFn)
  const verify = useServerFn(verifyDomainFn)
  const setEnforced = useServerFn(setVerifiedDomainEnforcedFn)
  const { open: openTestSignIn } = useSsoTestSignIn()

  const [pending, setPending] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyDomainResult | null>(null)
  const [enforceError, setEnforceError] = useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [enforceConfirmOpen, setEnforceConfirmOpen] = useState(false)

  const isVerified = domain.verifiedAt !== null

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings', 'verifiedDomains'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'ssoStatus'] }),
    ])
  }

  async function handleVerify() {
    setVerifyResult(null)
    setPending(true)
    try {
      const r = await verify({ data: { id: domain.id } })
      setVerifyResult(r)
      if (r.verified) await refresh()
    } catch {
      setVerifyResult({ verified: false, reason: 'lookup-failed' })
    } finally {
      setPending(false)
    }
  }

  async function handleRemove() {
    setPending(true)
    try {
      await remove({ data: { id: domain.id } })
      await refresh()
    } finally {
      setPending(false)
      setRemoveOpen(false)
    }
  }

  async function applyEnforced(next: boolean) {
    setEnforceError(null)
    setPending(true)
    try {
      await setEnforced({ data: { id: domain.id, enforced: next } })
      await refresh()
    } catch (err) {
      setEnforceError(err instanceof Error ? err.message : 'Could not change enforcement.')
    } finally {
      setPending(false)
      setEnforceConfirmOpen(false)
    }
  }

  /**
   * Require SSO toggle handler. Turning OFF is immediate. Turning ON:
   *  - not test-eligible → open the shared test sign-in modal; an
   *    identity-matched success auto-advances to the confirm dialog
   *  - eligible → straight to the confirm dialog
   * The toggle itself is never disabled for eligibility — only for an
   * unverified domain (which the parent already guards by not rendering
   * the toggle until verified).
   */
  function handleEnforceToggle(next: boolean) {
    if (!next) {
      void applyEnforced(false)
      return
    }
    if (!enforcementEligible) {
      openTestSignIn({
        reason: `Test sign-in required before enforcing SSO on ${domain.name}.`,
        onSuccess: () => setEnforceConfirmOpen(true),
      })
      return
    }
    setEnforceConfirmOpen(true)
  }

  return {
    pending,
    verifyResult,
    enforceError,
    removeOpen,
    setRemoveOpen,
    enforceConfirmOpen,
    setEnforceConfirmOpen,
    isVerified,
    handleVerify,
    handleRemove,
    applyEnforced,
    handleEnforceToggle,
  }
}

function DomainRow({
  domain,
  enforcementEligible,
}: {
  domain: VerifiedDomain
  enforcementEligible: boolean
}) {
  const {
    pending,
    verifyResult,
    enforceError,
    removeOpen,
    setRemoveOpen,
    enforceConfirmOpen,
    setEnforceConfirmOpen,
    isVerified,
    handleVerify,
    handleRemove,
    applyEnforced,
    handleEnforceToggle,
  } = useDomainEnforcement(domain, enforcementEligible)

  return (
    <>
      <TableRow>
        <TableCell className="font-medium align-top">
          <div className="flex items-center gap-2">
            {isVerified ? (
              <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <ClockIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <span className="truncate">{domain.name}</span>
          </div>
        </TableCell>

        <TableCell className="text-xs text-muted-foreground align-top">
          {isVerified ? (
            <span>
              Verified <TimeAgo date={domain.verifiedAt!} />
            </span>
          ) : (
            <span>Pending verification</span>
          )}
        </TableCell>

        <TableCell className="align-top">
          {isVerified && (
            <Switch
              checked={domain.enforced}
              onCheckedChange={handleEnforceToggle}
              disabled={pending}
              aria-label={`Require SSO for ${domain.name}`}
            />
          )}
        </TableCell>

        <TableCell className="text-right align-top">
          <div className="flex justify-end gap-1">
            {!isVerified && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleVerify}
                disabled={pending}
                className="h-9"
              >
                {pending ? 'Verifying…' : 'Verify'}
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setRemoveOpen(true)}
              disabled={pending}
              aria-label={`Remove ${domain.name}`}
              title={`Remove ${domain.name}`}
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {!isVerified && (
        <TableRow className="border-t-0 hover:bg-transparent">
          <TableCell colSpan={4} className="bg-muted/30 py-3">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Add this DNS TXT record at your registrar, then click <b>Verify</b>:
              </p>
              <DnsRecordRow label="Name" value={`_quackback-verify.${domain.name}`} />
              <DnsRecordRow label="Value" value={`qb-domain-verify=${domain.verificationToken}`} />
              <DnsRecordRow
                label="Check"
                value={`dig +short TXT _quackback-verify.${domain.name}`}
              />
              {verifyResult && !verifyResult.verified && (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">
                    {VERIFY_REASON_MESSAGES[verifyResult.reason]}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}

      {isVerified && enforceError && !domain.enforced && (
        <TableRow className="border-t-0 hover:bg-transparent">
          <TableCell colSpan={4} className="bg-muted/30 py-2">
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{enforceError}</AlertDescription>
            </Alert>
          </TableCell>
        </TableRow>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${isVerified ? 'verified' : 'pending'} domain?`}
        description={
          isVerified
            ? `Stops routing *@${domain.name} emails to SSO and disables hard-binding.`
            : `Discards the pending verification token for ${domain.name}.`
        }
        variant="destructive"
        confirmLabel="Remove"
        isPending={pending}
        onConfirm={handleRemove}
      />
      <ConfirmDialog
        open={enforceConfirmOpen}
        onOpenChange={setEnforceConfirmOpen}
        title={`Require SSO for ${domain.name}?`}
        description={`*@${domain.name} can then only sign in via SSO. If your IdP goes down, recover with your recovery codes — or with an admin at a different domain.`}
        warning={{
          title: 'This takes effect immediately.',
        }}
        confirmLabel="Require SSO"
        isPending={pending}
        onConfirm={() => applyEnforced(true)}
      />
    </>
  )
}

/**
 * Mobile card for a single verified domain — shown below the md
 * breakpoint in place of the table row. Shares all mutation logic
 * with DomainRow; the DNS-instruction block expands inline when the
 * domain is pending, same as the table version.
 */
function DomainCard({
  domain,
  enforcementEligible,
}: {
  domain: VerifiedDomain
  enforcementEligible: boolean
}) {
  const {
    pending,
    verifyResult,
    enforceError,
    removeOpen,
    setRemoveOpen,
    enforceConfirmOpen,
    setEnforceConfirmOpen,
    isVerified,
    handleVerify,
    handleRemove,
    applyEnforced,
    handleEnforceToggle,
  } = useDomainEnforcement(domain, enforcementEligible)

  return (
    <>
      <div className="p-4 space-y-3">
        {/* Primary identifier */}
        <div className="flex items-center gap-2">
          {isVerified ? (
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
          ) : (
            <ClockIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <span className="font-medium text-sm truncate">{domain.name}</span>
        </div>

        {/* Secondary fields */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {isVerified ? (
              <>
                Verified <TimeAgo date={domain.verifiedAt!} />
              </>
            ) : (
              'Pending verification'
            )}
          </span>
          {isVerified && (
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`require-sso-card-${domain.id}`}
                className="text-xs text-muted-foreground"
              >
                Require SSO
              </Label>
              <Switch
                id={`require-sso-card-${domain.id}`}
                checked={domain.enforced}
                onCheckedChange={handleEnforceToggle}
                disabled={pending}
                aria-label={`Require SSO for ${domain.name}`}
              />
            </div>
          )}
        </div>

        {/* Enforcement error hint */}
        {isVerified && enforceError && !domain.enforced && (
          <div>
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{enforceError}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* DNS instructions (pending only) */}
        {!isVerified && (
          <div className="space-y-2 bg-muted/30 rounded-md p-3">
            <p className="text-xs text-muted-foreground">
              Add this DNS TXT record at your registrar, then tap <b>Verify</b>:
            </p>
            <DnsRecordRow label="Name" value={`_quackback-verify.${domain.name}`} />
            <DnsRecordRow label="Value" value={`qb-domain-verify=${domain.verificationToken}`} />
            <DnsRecordRow label="Check" value={`dig +short TXT _quackback-verify.${domain.name}`} />
            {verifyResult && !verifyResult.verified && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  {VERIFY_REASON_MESSAGES[verifyResult.reason]}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 pt-1">
          {!isVerified && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleVerify}
              disabled={pending}
              className="h-9 flex-1"
            >
              {pending ? 'Verifying…' : 'Verify'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRemoveOpen(true)}
            disabled={pending}
            aria-label={`Remove ${domain.name}`}
            className="h-9 text-muted-foreground hover:text-destructive"
          >
            <TrashIcon className="h-4 w-4 mr-1.5" />
            Remove
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${isVerified ? 'verified' : 'pending'} domain?`}
        description={
          isVerified
            ? `Stops routing *@${domain.name} emails to SSO and disables hard-binding.`
            : `Discards the pending verification token for ${domain.name}.`
        }
        variant="destructive"
        confirmLabel="Remove"
        isPending={pending}
        onConfirm={handleRemove}
      />
      <ConfirmDialog
        open={enforceConfirmOpen}
        onOpenChange={setEnforceConfirmOpen}
        title={`Require SSO for ${domain.name}?`}
        description={`*@${domain.name} can then only sign in via SSO. If your IdP goes down, recover with your recovery codes — or with an admin at a different domain.`}
        warning={{
          title: 'This takes effect immediately.',
        }}
        confirmLabel="Require SSO"
        isPending={pending}
        onConfirm={() => applyEnforced(true)}
      />
    </>
  )
}

/**
 * Shared logic for the "add domain" affordance. Renders either the
 * collapsed trigger or the inline form. The caller wraps this in the
 * appropriate container (table row or plain div).
 */
function useAddDomainState({ atCap, count }: { atCap: boolean; count: number }) {
  const queryClient = useQueryClient()
  const addDomain = useServerFn(addVerifiedDomainFn)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const reset = () => {
    setDraftName('')
    setError('')
    setEditing(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draftName.trim()) return
    setError('')
    setPending(true)
    try {
      await addDomain({ data: { name: draftName.trim() } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', 'verifiedDomains'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'ssoStatus'] }),
      ])
      reset()
    } catch (err) {
      setError((err as Error).message || 'Could not add domain.')
    } finally {
      setPending(false)
    }
  }

  return {
    editing,
    setEditing,
    draftName,
    setDraftName,
    error,
    pending,
    reset,
    handleSubmit,
    atCap,
    count,
  }
}

/** Collapsed trigger button — shared between table and card layouts. */
function AddDomainTrigger({
  atCap,
  count,
  onEdit,
}: {
  atCap: boolean
  count: number
  onEdit: () => void
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      disabled={atCap}
      className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex items-center gap-2">
        <PlusIcon className="h-3.5 w-3.5" />
        Add domain
      </span>
      <span>
        {count} of {MAX_VERIFIED_DOMAINS}
        {atCap && ' (limit reached)'}
      </span>
    </button>
  )
}

/** Inline add form — shared between table and card layouts. */
function AddDomainForm({
  draftName,
  setDraftName,
  error,
  pending,
  reset,
  handleSubmit,
}: ReturnType<typeof useAddDomainState>) {
  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="add-verified-domain" className="sr-only">
          Domain
        </Label>
        <Input
          id="add-verified-domain"
          placeholder="acme.com"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !pending) reset()
          }}
          disabled={pending}
          autoFocus
          className="h-9"
        />
        <Button type="submit" disabled={pending || !draftName.trim()} size="sm" className="h-9">
          {pending ? 'Adding…' : 'Add'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={pending}
          className="h-9"
        >
          Cancel
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}

/**
 * Table-footer row for adding a new domain. Used at md+ inside the
 * `<TableFooter>`. For the mobile card layout, use `AddDomainCardRow`.
 */
function AddDomainFooter({ atCap, count }: { atCap: boolean; count: number }) {
  const state = useAddDomainState({ atCap, count })
  const { editing, setEditing } = state

  if (!editing) {
    return (
      <TableRow className="hover:bg-muted/40">
        <TableCell colSpan={4} className="p-0">
          <AddDomainTrigger atCap={atCap} count={count} onEdit={() => setEditing(true)} />
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={4} className="bg-muted/30">
        <AddDomainForm {...state} />
      </TableCell>
    </TableRow>
  )
}

/**
 * Non-table version of the add-domain affordance. Used below md in
 * the stacked card layout.
 */
function AddDomainCardRow({ atCap, count }: { atCap: boolean; count: number }) {
  const state = useAddDomainState({ atCap, count })
  const { editing, setEditing } = state

  if (!editing) {
    return (
      <div className="hover:bg-muted/40">
        <AddDomainTrigger atCap={atCap} count={count} onEdit={() => setEditing(true)} />
      </div>
    )
  }

  return (
    <div className="bg-muted/30 px-4 py-3">
      <AddDomainForm {...state} />
    </div>
  )
}

function DnsRecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-muted-foreground uppercase">{label}</span>
      <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{value}</code>
      <CopyButton value={value} aria-label={`Copy ${label}`} />
    </div>
  )
}
