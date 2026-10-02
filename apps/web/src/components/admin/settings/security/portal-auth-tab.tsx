import { useState, useTransition, useRef } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { ArrowPathIcon, ArrowRightIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { VisibilityTiles } from '@/components/admin/settings/visibility-tiles'
import { AUTOSAVE } from '@/lib/client/autosave'
import { PortalPrivacyDialog } from '@/components/admin/settings/portal-privacy-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { updatePortalAccessFn } from '@/lib/server/functions/portal-access'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'
import { listSegmentsFn } from '@/lib/server/functions/admin'
import { InvitePeopleDialog } from '@/components/admin/users/invite-people-dialog'
import { usePortalInvites } from '@/components/admin/users/use-portal-invites'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { cn } from '@/lib/shared/utils'
import type { PortalConfig } from '@/lib/shared/types/settings'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'

interface PortalAuthTabProps {
  portalConfig: PortalConfig
  /**
   * `authConfig.openSignup` — the workspace-wide answer the portal falls back
   * to when it has never been given one of its own. Passed in so the signup
   * toggle can show what the portal is ACTUALLY doing rather than a guess; see
   * `signupOpenFor` in `auth/signup-policy.ts` for the fallback itself.
   */
  teamOpenSignup: boolean
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
// Visibility options
// ---------------------------------------------------------------------------

type Visibility = 'public' | 'private'

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    title: 'Everyone',
    description: 'Anyone can view your portal without signing in.',
  },
  {
    value: 'private',
    title: 'Only your team and users you invite',
    description: 'Everyone else sees a sign-in page.',
  },
] satisfies { value: Visibility; title: string; description: string }[]

export function PortalAuthTab({ portalConfig, teamOpenSignup }: PortalAuthTabProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // --- Portal visibility + allowed-domains: shared busy lock ---
  //
  // A single `accessBusy` flag covers both visibility and domain saves so
  // the two fields can never race. Refs hold the current logical values so
  // that every call to `applyAccess` reads fresh state regardless of when
  // the closure was created — no stale capture is possible.

  const currentVisibility = (portalConfig.access?.visibility ?? 'public') as Visibility
  const [visibility, setVisibility] = useState<Visibility>(currentVisibility)
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

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingVisibility, setPendingVisibility] = useState<Visibility | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const [domainInputError, setDomainInputError] = useState<string | null>(null)

  // --- Self-service signup ---
  //
  // Its own busy flag rather than the access lock: it writes a different
  // column through a different endpoint, so serialising it against visibility
  // saves would only make two independent controls block each other.
  //
  // An absent `portalConfig.openSignup` means this portal has never been given
  // an answer of its own and follows the workspace-wide one, which is what the
  // policy does. Showing that resolved value is the point: an admin has to see
  // what the portal is doing before deciding to change it. The first save
  // writes an explicit portal answer, and the fallback stops applying.
  const [openSignup, setOpenSignup] = useState<boolean>(portalConfig.openSignup ?? teamOpenSignup)

  // Workspace-wide master switch for anonymous interaction. Collapsed in
  // migration 0084 from the legacy anonymousVoting / Commenting / Posting
  // trio — per-board access tiers carry the finer-grained restrictions.
  const [allowAnonymous, setAllowAnonymous] = useState<boolean>(
    portalConfig.features?.allowAnonymous ?? true
  )

  // Each save is an autosave mutation: the header shows its status and a
  // failure reverts the control and shows the one toast.
  const anonMutation = useMutation({
    meta: AUTOSAVE,
    mutationFn: (next: boolean) =>
      updatePortalConfigFn({ data: { features: { allowAnonymous: next } } }),
    onMutate: (next) => {
      const previous = allowAnonymous
      setAllowAnonymous(next)
      return { previous }
    },
    onSuccess: () => {
      startTransition(() => {
        router.invalidate()
      })
    },
    onError: (_error, _next, context) => {
      if (context) setAllowAnonymous(context.previous)
    },
  })
  const anonBusy = anonMutation.isPending

  const signupMutation = useMutation({
    meta: AUTOSAVE,
    mutationFn: (next: boolean) => updatePortalConfigFn({ data: { openSignup: next } }),
    onMutate: (next) => {
      const previous = openSignup
      setOpenSignup(next)
      return { previous }
    },
    onSuccess: () => {
      startTransition(() => {
        router.invalidate()
      })
    },
    onError: (_error, _next, context) => {
      if (context) setOpenSignup(context.previous)
    },
  })
  const signupBusy = signupMutation.isPending

  /**
   * Single save path for visibility, domain, and widget sign-in changes.
   *
   * The changed field is supplied explicitly by the caller; all peer fields
   * are read from their refs so stale-closure captures are impossible. This
   * ensures:
   *  - No two saves overlap (`accessBusy` gates all the controls).
   *  - No field persists a stale value: the caller owns its field, refs own
   *    the peers.
   */
  const accessMutation = useMutation({
    meta: AUTOSAVE,
    mutationFn: (next: {
      visibility: Visibility
      allowedDomains: string[]
      widgetSignIn: boolean
      allowedSegmentIds: string[]
    }) => updatePortalAccessFn({ data: next }),
    onMutate: (next) => {
      const previous = {
        visibility: visibilityRef.current,
        allowedDomains: allowedDomainsRef.current,
        widgetSignIn: widgetSignInRef.current,
        allowedSegmentIds: allowedSegmentIdsRef.current,
      }
      // Optimistic update
      setVisibility(next.visibility)
      setAllowedDomains(next.allowedDomains)
      setWidgetSignIn(next.widgetSignIn)
      setAllowedSegmentIds(next.allowedSegmentIds)
      return { previous }
    },
    onSuccess: () => {
      startTransition(() => {
        router.invalidate()
      })
    },
    onError: (_error, _next, context) => {
      // Revert all fields on error
      if (!context) return
      setVisibility(context.previous.visibility)
      setAllowedDomains(context.previous.allowedDomains)
      setWidgetSignIn(context.previous.widgetSignIn)
      setAllowedSegmentIds(context.previous.allowedSegmentIds)
    },
  })
  const accessBusy = accessMutation.isPending
  const isAccessBusy = accessBusy || isPending

  function applyAccess(
    nextVisibility: Visibility,
    nextDomains: string[],
    nextWidgetSignIn?: boolean,
    nextSegmentIds?: string[]
  ) {
    accessMutation.mutate({
      visibility: nextVisibility,
      allowedDomains: nextDomains,
      widgetSignIn: nextWidgetSignIn ?? widgetSignInRef.current,
      allowedSegmentIds: nextSegmentIds ?? allowedSegmentIdsRef.current,
    })
  }

  function handleVisibilitySelect(next: Visibility) {
    if (next === visibilityRef.current || isAccessBusy) return

    if (next === 'private') {
      setPendingVisibility('private')
      setDialogOpen(true)
    } else {
      // Changing to public: keep current domains (ref) alongside new visibility
      applyAccess('public', allowedDomainsRef.current)
    }
  }

  function handleConfirmPrivate() {
    setDialogOpen(false)
    if (pendingVisibility === 'private') {
      setPendingVisibility(null)
      // Changing to private: keep current domains (ref) alongside new visibility
      applyAccess('private', allowedDomainsRef.current)
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
    applyAccess(visibilityRef.current, [...allowedDomainsRef.current, raw])
  }

  function handleRemoveDomain(domain: string) {
    // Keep current visibility (ref); update domains
    applyAccess(
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
      {/* Portal visibility: the who-can-view choice and the anonymous switch.
          The four authorization channels each get their own SettingsCard below
          (only when private) so each one stands on its own. */}
      <SettingsCard title="Portal visibility" description="Choose who can view your portal.">
        <div className="space-y-4">
          <VisibilityTiles
            name="portal-visibility"
            value={visibility}
            onChange={handleVisibilitySelect}
            options={VISIBILITY_OPTIONS}
            disabled={isAccessBusy}
            className="sm:grid-cols-2"
          />

          {/* Directly under the tiles, so the team-always-has-access reassurance
              appears at the exact moment an admin picks the private option. */}
          {visibility === 'private' && (
            <p className="text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">Your team always has access.</span> Use
              the cards below to authorize additional visitors.
            </p>
          )}

          <div className="border-t border-border/50 pt-1">
            <SettingRow
              label="Allow anonymous interaction"
              description="When off, all boards require sign-in for voting, commenting, and submitting posts."
              htmlFor="allow-anonymous"
              className="pb-0"
              control={
                <Switch
                  id="allow-anonymous"
                  checked={allowAnonymous}
                  onCheckedChange={(checked) => anonMutation.mutate(checked)}
                  disabled={anonBusy || isPending}
                  aria-label="Allow anonymous interaction"
                />
              }
            />
          </div>
        </div>
      </SettingsCard>

      {/* Who may open an account, as opposed to who may look. Kept a peer of
          visibility and shown in both modes: a public portal that anyone can
          read still has to decide whether anyone can join it. */}
      <SettingsCard>
        <SettingRow
          label="Let visitors create an account"
          description={
            openSignup
              ? 'Anyone can create an account to post, vote and comment.'
              : 'Only users you invite, and users already holding an account, can sign in.'
          }
          htmlFor="portal-open-signup-toggle"
          className="py-0"
          control={
            <Switch
              id="portal-open-signup-toggle"
              checked={openSignup}
              onCheckedChange={(checked) => signupMutation.mutate(checked)}
              disabled={signupBusy || isPending}
              aria-label="Let visitors create an account"
            />
          }
        />
      </SettingsCard>

      {/* The authorization channels — each a peer card of Portal visibility,
          only shown when Private is selected. Public mode collapses all four
          since they only ever affect non-team visitors on a private portal. */}
      {visibility === 'private' && (
        <>
          <SettingsCard
            title="Allowed email domains"
            description="Anyone signed in with a verified email on these domains can view the portal."
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
                  No domains yet. Add one to grant access to everyone with a verified address at
                  that domain.
                </p>
              )}
            </div>
          </SettingsCard>

          <PortalInvitesSection />

          <SettingsCard
            title="Allowed segments"
            description="Members of these segments can view the portal. Segments are defined on the Users page."
          >
            {segmentsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading segments…</p>
            ) : segmentsQuery.isError ? (
              <p className="text-xs text-destructive">
                Could not load segments. Reload the page to try again.
              </p>
            ) : (segmentsQuery.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No segments defined yet. Create segments on the Users page.
              </p>
            ) : (
              <div className="space-y-3">
                <SegmentMultiSelect
                  segments={segmentsQuery.data ?? []}
                  value={allowedSegmentIds}
                  onChange={(next) => {
                    applyAccess(
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

          <SettingsCard>
            <SettingRow
              label="Widget sign-in"
              description="Let users signed in through the widget continue in the full portal."
              htmlFor="widget-signin-toggle"
              className="py-0"
              control={
                <Switch
                  id="widget-signin-toggle"
                  checked={widgetSignIn}
                  onCheckedChange={(checked) => {
                    applyAccess(visibilityRef.current, allowedDomainsRef.current, checked)
                  }}
                  disabled={isAccessBusy}
                />
              }
            />
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
      description="Invite users by email. They get a magic link to sign in."
      action={
        <Button type="button" size="sm" variant="outline" onClick={portal.openDialog}>
          <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
          Invite users
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
          <p className="text-xs text-success" role="status">
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
        No invites sent yet. Use Invite users to send the first one.
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
        className={`${INLINE_LINK} inline-flex items-center gap-1 text-xs`}
      >
        Manage invites
        <ArrowRightIcon className="h-3 w-3" />
      </Link>
    </div>
  )
}
