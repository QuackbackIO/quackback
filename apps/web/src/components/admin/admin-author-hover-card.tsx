/**
 * AdminAuthorHoverCard
 *
 * Admin sibling of the portal author hover card. Same lazy 200ms open /
 * fetch-on-open / null-payload = no card contract, plus people.view-gated
 * team rows (email, company, last seen, segments) and a footer that opens
 * the admin user profile (`/admin/users?selected=`).
 *
 * Anonymous and service principals never resolve a public profile, so they
 * never get a card — same anti-enumeration contract as the portal.
 */
import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import {
  getPublicUserProfileFn,
  getProfileTeamContextFn,
  type ProfileTeamContextView,
} from '@/lib/server/functions/public-profile'

const HOVER_OPEN_DELAY_MS = 200
const HOVER_CLOSE_DELAY_MS = 150
const MAX_VISIBLE_SEGMENTS = 2

interface AdminAuthorHoverCardProps {
  principalId: string
  displayName: string | null
  children: ReactNode
  className?: string
}

export function AdminAuthorHoverCard({
  principalId,
  displayName,
  children,
  className,
}: AdminAuthorHoverCardProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const profileQuery = useQuery({
    queryKey: ['portal', 'author-hover-card', principalId],
    queryFn: () => getPublicUserProfileFn({ data: { principalId } }),
    enabled: open,
    staleTime: 60_000,
  })
  const teamQuery = useQuery({
    queryKey: ['admin', 'author-hover-card-team', principalId],
    queryFn: () => getProfileTeamContextFn({ data: { principalId } }),
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
    e.preventDefault()
    e.stopPropagation()
    void navigate({ to: '/admin/users', search: { selected: principalId } })
  }

  const profile = profileQuery.data ?? null
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
        className="w-72 p-3"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
      >
        {profileQuery.isLoading ? (
          <CardSkeleton />
        ) : profile ? (
          <div data-testid="admin-author-hover-card-body">
            <div className="flex items-center gap-3">
              <Avatar
                src={profile.avatarUrl}
                name={profile.displayName || displayName}
                className="size-10"
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {profile.displayName || displayName || 'Anonymous'}
                  </span>
                  {teamQuery.data?.emailVerified && (
                    <CheckCircleIcon className="size-3.5 shrink-0 text-primary" />
                  )}
                  {teamQuery.data?.blocked && (
                    <Badge variant="destructive" size="sm" className="shrink-0">
                      Blocked
                    </Badge>
                  )}
                </div>
                {teamQuery.data?.email ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {teamQuery.data.email}
                  </div>
                ) : teamQuery.isLoading ? (
                  <Skeleton className="mt-0.5 h-3 w-32" />
                ) : null}
              </div>
            </div>

            <TeamInfoRows team={teamQuery.data ?? null} isLoading={teamQuery.isLoading} />

            <div className="mt-3 flex items-center border-t border-border/50 pt-2.5">
              <CardStat value={profile.postCount} label="Posts" />
              <CardStat value={profile.commentCount} label="Comments" />
              <CardStat value={profile.voteCount} label="Votes" />
            </div>

            <button
              type="button"
              onClick={goToProfile}
              className="mt-3 flex w-full items-center justify-between border-t border-border/50 pt-2.5 text-primary"
            >
              <span className="text-xs font-medium">Open full profile</span>
              <ArrowRightIcon className="size-3.5" />
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function TeamInfoRows({
  team,
  isLoading,
}: {
  team: ProfileTeamContextView | null
  isLoading: boolean
}) {
  if (isLoading && !team) {
    return (
      <div className="mt-3 space-y-[5px] border-t border-border/50 pt-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }
  if (!team) return null

  const segments = team.segments
  // At most two chips in the row: two names, or one name plus a +N counter
  // so the card height stays fixed however many segments the person is in.
  const visibleCount = segments.length > MAX_VISIBLE_SEGMENTS ? 1 : segments.length
  const visible = segments.slice(0, visibleCount)
  const overflow = segments.length - visible.length

  return (
    <div className="mt-3 flex flex-col gap-[5px] border-t border-border/50 pt-2.5 text-xs leading-4">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-muted-foreground">Company</span>
        <span className="min-w-0 truncate font-medium">
          {team.company ? (
            <>
              {team.company.name}
              {team.company.plan ? (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  &middot; {team.company.plan}
                </span>
              ) : null}
            </>
          ) : (
            <span className="font-normal text-muted-foreground">—</span>
          )}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-muted-foreground">Last seen</span>
        <span className="min-w-0 truncate">
          {team.lastSeenAt ? <TimeAgo date={team.lastSeenAt} /> : '—'}
        </span>
      </div>
      {segments.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-muted-foreground">Segments</span>
          <span className="flex min-w-0 items-center justify-end gap-1 overflow-hidden">
            {visible.map((seg) => (
              <span
                key={seg.id}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-1.5 py-px text-[11px] leading-[15px]"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                {seg.name}
              </span>
            ))}
            {overflow > 0 && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-border/60 px-1.5 py-px text-[11px] leading-[15px] text-muted-foreground">
                +{overflow}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function CardStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] leading-[14px] text-muted-foreground">{label}</div>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div data-testid="admin-author-hover-card-skeleton">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2 py-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="mt-3 space-y-[5px] border-t border-border/50 pt-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="mt-3 flex items-center border-t border-border/50 pt-2.5">
        <div className="flex flex-1 justify-center">
          <Skeleton className="h-[34px] w-10" />
        </div>
        <div className="flex flex-1 justify-center">
          <Skeleton className="h-[34px] w-10" />
        </div>
        <div className="flex flex-1 justify-center">
          <Skeleton className="h-[34px] w-10" />
        </div>
      </div>
      <div className="mt-3 border-t border-border/50 pt-2.5">
        <Skeleton className="h-4 w-36" />
      </div>
    </div>
  )
}
