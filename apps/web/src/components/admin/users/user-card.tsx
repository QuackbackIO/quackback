import {
  CheckCircleIcon,
  ChatBubbleLeftIcon,
  DocumentTextIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/solid'
import { Avatar } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import { countryName, countryFlag } from '@/lib/shared/country'
import type { PortalUserListItemView } from '@/lib/shared/types'
import { CompactSegmentBadges } from '@/components/admin/users/user-segments'

interface UserCardProps {
  user: PortalUserListItemView
  isSelected: boolean
  onClick: () => void
  /** Gates the bulk-selection checkbox, matching the per-user segment editor's admin-only gate. */
  canManage: boolean
  checked: boolean
  onToggleCheck: () => void
  /** Shows the optional Country field, toggled from the list's column picker. */
  showCountry?: boolean
}

export function UserCard({
  user,
  isSelected,
  onClick,
  canManage,
  checked,
  onToggleCheck,
  showCountry = false,
}: UserCardProps) {
  const totalActivity = user.postCount + user.commentCount + user.voteCount
  // Both fields are sanitised in the DTO (`user.service.ts`), so a placeholder
  // is already null by the time it reaches here.
  const displayEmail = user.email ?? user.contactEmail

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 cursor-pointer transition-colors relative',
        isSelected
          ? 'bg-muted/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-muted/30'
      )}
      onClick={onClick}
    >
      {/* Bulk-selection checkbox */}
      {canManage && (
        <div className="flex items-center pt-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={checked}
            onCheckedChange={onToggleCheck}
            aria-label={`Select ${user.name || 'this user'}`}
          />
        </div>
      )}

      {/* Avatar */}
      <Avatar src={user.image} name={user.name} className="h-10 w-10 shrink-0" />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name row */}
        <div className="flex items-center gap-1.5">
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

        {/* Identified account address, or a lead's captured contact address.
            Both arrive already sanitised from the DTO, so a placeholder reads
            as absent here rather than as something an agent could write to. */}
        {displayEmail ? (
          <p className="text-sm text-muted-foreground truncate">{displayEmail}</p>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic">No email</p>
        )}

        {/* Join date + freshest activity signal */}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span>Joined</span>
            <TimeAgo date={new Date(user.joinedAt)} />
          </span>
          {user.lastSeenAt && (
            <span className="flex items-center gap-1.5">
              <span>Seen</span>
              <TimeAgo date={new Date(user.lastSeenAt)} />
            </span>
          )}
        </div>

        {/* Country - opt-in via the list's column picker */}
        {showCountry && (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
            {user.country ? (
              <span className="flex items-center gap-1">
                <span aria-hidden="true">{countryFlag(user.country)}</span>
                <span>{countryName(user.country)}</span>
              </span>
            ) : (
              <span>-</span>
            )}
          </div>
        )}

        {/* Activity summary */}
        {totalActivity > 0 && (
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
            {user.postCount > 0 && (
              <span className="flex items-center gap-1">
                <DocumentTextIcon className="h-3 w-3" />
                {user.postCount}
              </span>
            )}
            {user.commentCount > 0 && (
              <span className="flex items-center gap-1">
                <ChatBubbleLeftIcon className="h-3 w-3" />
                {user.commentCount}
              </span>
            )}
            {user.voteCount > 0 && (
              <span className="flex items-center gap-1">
                <HandThumbUpIcon className="h-3 w-3" />
                {user.voteCount}
              </span>
            )}
          </div>
        )}

        {/* Segment badges */}
        {user.segments.length > 0 && (
          <div className="mt-1.5">
            <CompactSegmentBadges segments={user.segments} maxVisible={3} />
          </div>
        )}
      </div>
    </div>
  )
}
