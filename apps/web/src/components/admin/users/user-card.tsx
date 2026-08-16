import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo, getTimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import { countryName, countryFlag } from '@/lib/shared/country'
import type { PortalUserListItemView } from '@/lib/shared/types'

/**
 * Fixed column widths shared between each row cell and its header in
 * `UsersList`, so every field lines up in a vertical lane under its label
 * instead of drifting with row content.
 */
export const METRIC_COLUMN_WIDTH = 'w-14'
export const EMAIL_COLUMN_WIDTH = 'w-48'
export const JOINED_COLUMN_WIDTH = 'w-36'
export const COUNTRY_COLUMN_WIDTH = 'w-32'

interface UserCardProps {
  user: PortalUserListItemView
  isSelected: boolean
  onClick: () => void
  /** Shows the optional Country column, toggled from the list's column picker. */
  showCountry?: boolean
}

export function UserCard({ user, isSelected, onClick, showCountry = false }: UserCardProps) {
  // Both fields are sanitised in the DTO (`user.service.ts`), so a placeholder
  // is already null by the time it reaches here.
  const displayEmail = user.email ?? user.contactEmail
  const lastSeenTitle = user.lastSeenAt ? `Last seen ${getTimeAgo(user.lastSeenAt)}` : undefined

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors relative',
        isSelected
          ? 'bg-muted/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-muted/30'
      )}
      onClick={onClick}
    >
      {/* Avatar */}
      <Avatar src={user.image} name={user.name} className="h-8 w-8 shrink-0" />

      {/* Name column */}
      <div className="min-w-0 flex-1 flex items-center gap-1.5">
        <h3 className="font-medium text-sm text-foreground truncate">
          {user.name || 'Unnamed User'}
        </h3>
        {user.isLead ? (
          <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-px text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Lead
          </span>
        ) : (
          user.emailVerified && <CheckCircleIcon className="h-3.5 w-3.5 text-primary shrink-0" />
        )}
      </div>

      {/* Email column — the identified account address, or a lead's captured
          contact address. Both arrive already sanitised from the DTO, so a
          placeholder reads as absent here rather than as something an agent
          could write to. */}
      <div className={cn(EMAIL_COLUMN_WIDTH, 'shrink-0')}>
        {displayEmail ? (
          <p className="text-sm text-muted-foreground truncate">{displayEmail}</p>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic truncate">No email</p>
        )}
      </div>

      {/* Joined column. Last-active surfaces as a tooltip on the same cell
          rather than a second line, keeping the row scannable at one line. */}
      <div
        className={cn(
          JOINED_COLUMN_WIDTH,
          'shrink-0 whitespace-nowrap text-xs text-muted-foreground'
        )}
      >
        <span title={lastSeenTitle}>
          <TimeAgo date={new Date(user.joinedAt)} />
        </span>
      </div>

      {/* Country column — opt-in via the list's column picker */}
      {showCountry && (
        <div className={cn(COUNTRY_COLUMN_WIDTH, 'shrink-0 text-xs text-muted-foreground')}>
          {user.country ? (
            <span className="flex items-center gap-1 truncate">
              <span aria-hidden="true">{countryFlag(user.country)}</span>
              <span className="truncate">{countryName(user.country)}</span>
            </span>
          ) : (
            <span>-</span>
          )}
        </div>
      )}

      {/* Post/comment/vote counts, as fixed-width columns that line up under the
          Posts/Comments/Votes headers in `UsersList` — always shown (rather than
          hidden when zero) so the column stays put and can be scanned straight
          down instead of decoded row by row. */}
      <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
        <span className={cn(METRIC_COLUMN_WIDTH, 'text-right')} title="Posts">
          {user.postCount}
        </span>
        <span className={cn(METRIC_COLUMN_WIDTH, 'text-right')} title="Comments">
          {user.commentCount}
        </span>
        <span className={cn(METRIC_COLUMN_WIDTH, 'text-right')} title="Votes">
          {user.voteCount}
        </span>
      </div>
    </div>
  )
}
