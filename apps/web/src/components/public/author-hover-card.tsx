/**
 * AuthorHoverCard
 *
 * Wraps a portal author affordance (a name and/or avatar) so it links to the
 * public profile page (`/u/:principalId`) and, on pointer devices, reveals a
 * lazy hover card summarising the author.
 *
 * Behaviour:
 *   - The trigger is a `role="link"` span (never an `<a>`) so it nests safely
 *     inside the post-card `<Link>` without producing illegal nested anchors.
 *     Click / Enter navigate to the profile; propagation is stopped so the
 *     surrounding card link does not also fire.
 *   - The card fetches ON OPEN (not on mount) via `getPublicUserProfileFn`
 *     with a short staleTime, shows a skeleton while loading, and renders the
 *     avatar, name, team badge / "Member since {month year}", and the
 *     posts / comments / upvotes counts.
 *   - A null payload (anonymous / service principal, or nothing visible to
 *     this viewer) shows no card at all — the plain trigger text stays,
 *     click merely 404s. This is the anti-enumeration contract of the
 *     profile fn surfaced in the UI.
 *
 * Team-badge styling and the branding logo/label are read from the root route
 * context, matching the pinned-comment / mention-hover-card convention.
 */
import { useRef, useState, type ReactNode } from 'react'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckBadgeIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'
import { getPublicUserProfileFn } from '@/lib/server/functions/public-profile'

const HOVER_OPEN_DELAY_MS = 200
const HOVER_CLOSE_DELAY_MS = 150

interface PortalRootContext {
  settings?: {
    name?: string | null
    brandingData?: { logoUrl?: string | null; name?: string | null } | null
  } | null
}

interface AuthorHoverCardProps {
  /** Principal whose profile the trigger links to. */
  principalId: string
  /** Display name for the trigger (children carry the rendered form). */
  displayName: string | null
  children: ReactNode
  /** Extra classes for the trigger span. */
  className?: string
}

export function AuthorHoverCard({
  principalId,
  displayName,
  children,
  className,
}: AuthorHoverCardProps) {
  const intl = useIntl()
  const navigate = useNavigate()
  const ctx = useRouteContext({ from: '__root__' }) as PortalRootContext
  const teamBadgeLogoUrl = ctx.settings?.brandingData?.logoUrl ?? null
  const teamBadgeLabel =
    ctx.settings?.brandingData?.name ??
    ctx.settings?.name ??
    intl.formatMessage({ id: 'portal.profile.teamBadge', defaultMessage: 'Team' })

  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const profileQuery = useQuery({
    queryKey: ['portal', 'author-hover-card', principalId],
    queryFn: () => getPublicUserProfileFn({ data: { principalId } }),
    enabled: open,
    staleTime: 60_000,
  })

  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }

  function scheduleOpen() {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS)
  }

  function scheduleClose() {
    clearTimers()
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS)
  }

  function goToProfile(e: { preventDefault: () => void; stopPropagation: () => void }) {
    // Stop the surrounding card `<Link>` from also navigating to the post.
    e.preventDefault()
    e.stopPropagation()
    void navigate({ to: '/u/$principalId', params: { principalId } })
  }

  const profile = profileQuery.data ?? null
  // Only surface the popover while loading or once real content exists — a null
  // payload never renders an empty box.
  const hasCardContent = profileQuery.isLoading || !!profile

  return (
    <Popover open={open && hasCardContent} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          role="link"
          tabIndex={0}
          data-principal-id={principalId}
          onClick={goToProfile}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goToProfile(e)
          }}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onFocus={scheduleOpen}
          onBlur={scheduleClose}
          className={cn(
            'cursor-pointer rounded-sm hover:underline focus:outline-none focus-visible:underline',
            className
          )}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
      >
        {profileQuery.isLoading ? (
          <CardSkeleton />
        ) : profile ? (
          <div data-testid="author-hover-card-body">
            <div className="flex items-start gap-3">
              <Avatar
                src={profile.avatarUrl}
                name={profile.displayName || displayName}
                className="size-10"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {profile.displayName ||
                      intl.formatMessage({
                        id: 'portal.profile.nameFallback',
                        defaultMessage: 'Anonymous',
                      })}
                  </span>
                  {profile.isTeamMember && (
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary"
                      aria-label={intl.formatMessage(
                        {
                          id: 'portal.commentThread.teamBadgeAria',
                          defaultMessage: '{name} Member',
                        },
                        { name: teamBadgeLabel }
                      )}
                      title={intl.formatMessage(
                        { id: 'portal.commentThread.teamBadge', defaultMessage: '{name} Member' },
                        { name: teamBadgeLabel }
                      )}
                    >
                      {teamBadgeLogoUrl ? (
                        <img
                          src={teamBadgeLogoUrl}
                          alt=""
                          className="h-4 w-4 rounded-sm object-contain"
                        />
                      ) : (
                        <CheckBadgeIcon className="h-4 w-4" />
                      )}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <FormattedMessage
                    id="portal.profile.memberSince"
                    defaultMessage="Member since {date}"
                    values={{
                      date: intl.formatDate(new Date(profile.joinedAt), {
                        month: 'long',
                        year: 'numeric',
                      }),
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-4 border-t border-border/50 pt-2.5">
              <CardStat
                value={profile.postCount}
                label={intl.formatMessage({
                  id: 'portal.profile.stats.posts',
                  defaultMessage: 'Posts',
                })}
              />
              <CardStat
                value={profile.commentCount}
                label={intl.formatMessage({
                  id: 'portal.profile.stats.comments',
                  defaultMessage: 'Comments',
                })}
              />
              <CardStat
                value={profile.voteCount}
                label={intl.formatMessage({
                  id: 'portal.profile.stats.upvotes',
                  defaultMessage: 'Upvotes',
                })}
              />
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function CardStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div data-testid="author-hover-card-skeleton">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2 py-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 border-t border-border/50 pt-2.5">
        <Skeleton className="h-7 w-10" />
        <Skeleton className="h-7 w-10" />
        <Skeleton className="h-7 w-10" />
      </div>
    </div>
  )
}
