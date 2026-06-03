import { useState, useTransition, useRef } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  ArrowRightIcon,
  GlobeAltIcon,
  LockClosedIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PortalPrivacyDialog } from '@/components/admin/settings/portal-privacy-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { updatePortalAccessFn } from '@/lib/server/functions/portal-access'
import { listSegmentsFn } from '@/lib/server/functions/admin'
import { InvitePeopleDialog } from '@/components/admin/users/invite-people-dialog'
import { usePortalInvites } from '@/components/admin/users/use-portal-invites'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { cn } from '@/lib/shared/utils'
import type { PortalConfig } from '@/lib/shared/types/settings'

interface PortalAuthTabProps {
  portalConfig: PortalConfig
}

/**
 * Portal access tab — first of three concern-scoped tabs on the
 * /authentication page. Sole purpose is to control WHO can view the
 * portal: visibility (public/private), and the four authorization
 * channels that grant access to additional visitors when private
 * (allowed email domains, email invites, allowed segments, widget
 * sign-in).
 *
 * HOW visitors authenticate (password / magic link / social / OIDC)
 * lives on the sibling 'Sign-in providers' tab. WHO on the team has
 * what access (2FA enforcement, SSO summary) lives on the 'Team
 * access' tab.
 */
// ---------------------------------------------------------------------------
// Visibility option descriptors
// ---------------------------------------------------------------------------

interface VisibilityOption {
  value: 'public' | 'private'
  label: string
  description: string
  icon: typeof LockClosedIcon
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can view your portal without signing in.',
    icon: GlobeAltIcon,
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Only your team and the groups you authorize below.',
    icon: LockClosedIcon,
  },
]

export function PortalAuthTab({ portalConfig }: PortalAuthTabProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // --- Portal visibility + allowed-domains: shared busy lock ---
  //
  // A single `accessBusy` flag covers both visibility and domain saves so
  // the two fields can never race. Refs hold the current logical values so
  // that every call to `applyAccess` reads fresh state regardless of when
  // the closure was created — no stale capture is possible.

  const currentVisibility = (portalConfig.access?.visibility ?? 'public') as 'public' | 'private'
  const [visibility, setVisibility] = useState<'public' | 'private'>(currentVisibility)
  const visibilityRef = useRef(visibility)
  visibilityRef.current = visibility

  const [allowedDomains, setAllowedDomains] = useState<string[]>(
    portalConfig.access?.allowedDomains ?? []
  )
  const allowedDomainsRef = useRef(allowedDomains)
  allowedDomainsRef.current = allowedDomains

  const [widgetSignIn, setWidgetSignIn] = useState<boolean>(
    portalConfig.access?.widgetSignIn ?? false
  )
  const widgetSignInRef = useRef(widgetSignIn)
  widgetSignInRef.current = widgetSignIn

  const [allowedSegmentIds, setAllowedSegmentIds] = useState<string[]>(
    portalConfig.access?.allowedSegmentIds ?? []
  )
  const allowedSegmentIdsRef = useRef(allowedSegmentIds)
  allowedSegmentIdsRef.current = allowedSegmentIds

  const segmentsQuery = useQuery({
    queryKey: ['admin', 'segments'] as const,
    queryFn: () => listSegmentsFn(),
    staleTime: 60_000,
  })

  const [accessBusy, setAccessBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingVisibility, setPendingVisibility] = useState<'public' | 'private' | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const [domainInputError, setDomainInputError] = useState<string | null>(null)

  const isAccessBusy = accessBusy || isPending

  /**
   * Single save path for visibility, domain, and widget sign-in changes.
   *
   * The changed field is supplied explicitly by the caller; all peer fields
   * are read from their refs so stale-closure captures are impossible. This
   * ensures:
   *  - No two saves overlap (`accessBusy` gates all three controls).
   *  - No field persists a stale value: the caller owns its field, refs own
   *    the peers.
   */
  async function applyAccess(
    nextVisibility: 'public' | 'private',
    nextDomains: string[],
    nextWidgetSignIn?: boolean,
    nextSegmentIds?: string[]
  ) {
    const prevVisibility = visibilityRef.current
    const prevDomains = allowedDomainsRef.current
    const prevWidgetSignIn = widgetSignInRef.current
    const prevSegmentIds = allowedSegmentIdsRef.current
    const resolvedWidgetSignIn = nextWidgetSignIn ?? prevWidgetSignIn
    const resolvedSegmentIds = nextSegmentIds ?? prevSegmentIds

    // Optimistic update
    setVisibility(nextVisibility)
    setAllowedDomains(nextDomains)
    setWidgetSignIn(resolvedWidgetSignIn)
    setAllowedSegmentIds(resolvedSegmentIds)
    setAccessBusy(true)

    try {
      await updatePortalAccessFn({
        data: {
          visibility: nextVisibility,
          allowedDomains: nextDomains,
          widgetSignIn: resolvedWidgetSignIn,
          allowedSegmentIds: resolvedSegmentIds,
        },
      })
      startTransition(() => {
        router.invalidate()
      })
    } catch {
      // Revert all fields on error
      setVisibility(prevVisibility)
      setAllowedDomains(prevDomains)
      setWidgetSignIn(prevWidgetSignIn)
      setAllowedSegmentIds(prevSegmentIds)
    } finally {
      setAccessBusy(false)
    }
  }

  function handleVisibilitySelect(next: 'public' | 'private') {
    if (next === visibilityRef.current || isAccessBusy) return

    if (next === 'private') {
      setPendingVisibility('private')
      setDialogOpen(true)
    } else {
      // Changing to public: keep current domains (ref) alongside new visibility
      void applyAccess('public', allowedDomainsRef.current)
    }
  }

  function handleConfirmPrivate() {
    setDialogOpen(false)
    if (pendingVisibility === 'private') {
      setPendingVisibility(null)
      // Changing to private: keep current domains (ref) alongside new visibility
      void applyAccess('private', allowedDomainsRef.current)
    }
  }

  function handleCancelDialog(open: boolean) {
    if (!open) {
      setPendingVisibility(null)
    }
    setDialogOpen(open)
  }

  function handleAddDomain() {
    const raw = domainInput.trim().toLowerCase().replace(/^@/, '')
    if (!raw) return

    // Basic client-side validation matching server normalization rules
    if (raw.includes('://') || raw.includes('@') || /\s/.test(raw) || !raw.includes('.')) {
      setDomainInputError('Enter a valid domain, e.g. acme.com')
      return
    }

    if (allowedDomainsRef.current.includes(raw)) {
      setDomainInputError('Domain already in the list')
      return
    }

    setDomainInputError(null)
    setDomainInput('')
    // Keep current visibility (ref); update domains
    void applyAccess(visibilityRef.current, [...allowedDomainsRef.current, raw])
  }

  function handleRemoveDomain(domain: string) {
    // Keep current visibility (ref); update domains
    void applyAccess(
      visibilityRef.current,
      allowedDomainsRef.current.filter((d) => d !== domain)
    )
  }

  function handleDomainKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddDomain()
    }
  }

  // Managed-paths handling moved with the sign-in cards to the
  // Sign-in providers tab. The portal-access surface doesn't
  // currently expose any settings governed by config-file
  // management, so no `isManaged` plumbing is needed here.

  return (
    <div className="space-y-6">
      {/* Portal visibility — sole purpose is the public/private switch. The
          four authorization channels each get their own SettingsCard below
          (only when Private) so each one stands on its own. */}
      <SettingsCard title="Portal visibility" description="Choose who can view your portal.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VISIBILITY_OPTIONS.map((option) => {
            const isSelected = visibility === option.value
            const Icon = option.icon
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleVisibilitySelect(option.value)}
                disabled={isAccessBusy}
                className={cn(
                  'relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border/50 bg-card hover:border-border hover:bg-muted/30',
                  isAccessBusy && 'cursor-not-allowed opacity-60'
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isSelected ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <span className="text-sm font-medium">{option.label}</span>
                  {accessBusy && isSelected && (
                    <ArrowPathIcon className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </button>
            )
          })}
        </div>

        {/* Lives inside the visibility card, directly under the toggles, so
            the team-always-has-access reassurance appears at the exact moment
            an admin picks Private — not as a floating note between cards. */}
        {visibility === 'private' && (
          <p className="mt-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Your team always has access.</span> Use
            the cards below to authorize additional visitors.
          </p>
        )}
      </SettingsCard>

      {/* The authorization channels — each a peer card of Portal visibility,
          only shown when Private is selected. Public mode collapses all four
          since they only ever affect non-team visitors on a private portal. */}
      {visibility === 'private' && (
        <>
          <SettingsCard
            title="Allowed email domains"
            description="Anyone signed in with a verified email on these domains can view the portal. Users verify their address by clicking the link in the verification email we send on sign-up."
          >
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={domainInput}
                    onChange={(e) => {
                      setDomainInput(e.target.value)
                      if (domainInputError) setDomainInputError(null)
                    }}
                    onKeyDown={handleDomainKeyDown}
                    placeholder="acme.com"
                    disabled={isAccessBusy}
                    aria-label="Add email domain"
                    aria-invalid={!!domainInputError}
                    className={cn(domainInputError && 'border-destructive')}
                  />
                  {domainInputError && (
                    <p className="mt-1 text-xs text-destructive">{domainInputError}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddDomain}
                  disabled={!domainInput.trim() || isAccessBusy}
                  className="h-9 shrink-0"
                >
                  <PlusIcon className="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
                {accessBusy && (
                  <div className="flex items-center">
                    <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>

              {allowedDomains.length > 0 ? (
                <ul className="space-y-1.5" role="list" aria-label="Allowed domains">
                  {allowedDomains.map((domain) => (
                    <li
                      key={domain}
                      className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-1.5"
                    >
                      <span className="text-sm font-mono">{domain}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveDomain(domain)}
                        disabled={isAccessBusy}
                        className="ml-2 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 transition-colors"
                        aria-label={`Remove ${domain}`}
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No domains added — add one to grant access to everyone with a verified address at
                  that domain.
                </p>
              )}
            </div>
          </SettingsCard>

          <PortalInvitesSection />

          <SettingsCard
            title="Allowed segments"
            description="Members of these segments can view the portal. Segments are defined on the People page."
          >
            {segmentsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading segments…</p>
            ) : segmentsQuery.isError ? (
              <p className="text-xs text-destructive">
                Could not load segments. Reload the page to try again.
              </p>
            ) : (segmentsQuery.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No segments defined yet. Create segments on the People page.
              </p>
            ) : (
              <div className="space-y-3">
                <SegmentMultiSelect
                  segments={segmentsQuery.data ?? []}
                  value={allowedSegmentIds}
                  onChange={(next) => {
                    void applyAccess(
                      visibilityRef.current,
                      allowedDomainsRef.current,
                      widgetSignInRef.current,
                      next
                    )
                  }}
                  disabled={isAccessBusy}
                />
                {allowedSegmentIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Members of {allowedSegmentIds.length} selected segment
                    {allowedSegmentIds.length === 1 ? '' : 's'} can access this portal.
                  </p>
                )}
              </div>
            )}
          </SettingsCard>

          <SettingsCard
            title="Widget sign-in"
            description="Allow users authenticated through the widget (in verified-identity mode) to view this portal."
            action={
              <Switch
                id="widget-signin-toggle"
                checked={widgetSignIn}
                onCheckedChange={(checked) => {
                  void applyAccess(visibilityRef.current, allowedDomainsRef.current, checked)
                }}
                disabled={isAccessBusy}
                aria-label="Allow widget-authenticated users to access the portal"
              />
            }
          >
            <p className="text-xs text-muted-foreground">
              When enabled, widget users see a &ldquo;Go to portal&rdquo; link to continue in the
              full portal — useful if you want a single source of truth across the widget and the
              portal.
            </p>
          </SettingsCard>
        </>
      )}

      <PortalPrivacyDialog
        open={dialogOpen}
        onOpenChange={handleCancelDialog}
        onConfirm={handleConfirmPrivate}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// PortalInvitesSection
// ---------------------------------------------------------------------------

/**
 * Compact summary of portal invitations rendered inside the Portal Visibility
 * card. The full list (resend / revoke / copy-link / status filter) lives on
 * /admin/users?invites=pending — this section just shows counts and CTAs:
 *  - [+ Invite people] opens the same dialog that the Invitations view uses
 *  - [Manage invites →] deep-links to the full management view
 *
 * Keeping send-in-place + manage-elsewhere means an admin who just wants to
 * fire off invitations doesn't have to leave the Portal settings page, while
 * the cluttered per-row controls live in their natural home next to People.
 */
function PortalInvitesSection() {
  const portal = usePortalInvites()
  const totalCount = portal.invites.length

  return (
    <SettingsCard
      title="Email invites"
      description="Invite specific people by email. They'll get a magic link to sign in and access the portal."
      action={
        <Button type="button" size="sm" variant="outline" onClick={portal.openDialog}>
          <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
          Invite people
        </Button>
      }
    >
      <div className="space-y-3">
        <InviteSummary
          loading={portal.isLoading}
          totalCount={totalCount}
          pendingCount={portal.pendingCount}
          acceptedCount={portal.acceptedCount}
        />

        {/* Inline success summary after a send — modal closes, this fades. */}
        {portal.lastSentSummary && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
            {portal.lastSentSummary}
          </p>
        )}
      </div>

      <InvitePeopleDialog
        open={portal.dialogOpen}
        onOpenChange={portal.onOpenChange}
        emailsInput={portal.emailsInput}
        messageInput={portal.messageInput}
        emailError={portal.emailError}
        batchResults={portal.batchResults}
        sendBusy={portal.sendBusy}
        onEmailsChange={portal.onEmailsChange}
        onMessageChange={portal.onMessageChange}
        onSend={portal.onSend}
      />
    </SettingsCard>
  )
}

/**
 * One-line summary + Manage link. Splits the load state and the populated
 * state so the layout doesn't jitter once counts arrive.
 */
function InviteSummary({
  loading,
  totalCount,
  pendingCount,
  acceptedCount,
}: {
  loading: boolean
  totalCount: number
  pendingCount: number
  acceptedCount: number
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
        <span>Loading invites…</span>
      </div>
    )
  }

  if (totalCount === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No invites sent yet — use Invite people to send the first one.
      </p>
    )
  }

  const summary = [
    pendingCount > 0 ? `${pendingCount} pending` : null,
    acceptedCount > 0 ? `${acceptedCount} accepted` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{summary || `${totalCount} invites`}</p>
      <Link
        to="/admin/users"
        search={{ invites: 'pending' as const }}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-4"
      >
        Manage invites
        <ArrowRightIcon className="h-3 w-3" />
      </Link>
    </div>
  )
}
