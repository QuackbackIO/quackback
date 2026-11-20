import { ChatBubbleLeftIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { normalizeBoardAccess, presetForAccess } from '@/lib/shared/schemas/boards'
import type { BoardAccess } from '@/lib/shared/db-types'

interface BoardRow {
  id: string
  slug: string
  name: string
  description: string | null
  access: BoardAccess
  postCount: number
  /** Set by an admin. */
  readOnly?: boolean
  /** Kept read-only by the plan's board limit. */
  planReadOnly?: string
}

function usesSegments(access: BoardAccess): boolean {
  return Object.values(access.segments ?? {}).some((ids) => ids.length > 0)
}

/** A badge only for boards narrower than the portal; open boards stay quiet. */
function BoardAccessBadge({ access }: { access: BoardAccess }) {
  const normalized = normalizeBoardAccess(access)
  const segments = usesSegments(normalized)
  const teamOnly = presetForAccess(normalized) === 'private' || normalized.view === 'team'
  if (!teamOnly && !segments) return null
  return (
    <Badge size="sm" variant="secondary">
      {teamOnly ? (
        <>
          <LockClosedIcon />
          Team only
        </>
      ) : (
        'Segments'
      )}
    </Badge>
  )
}

function postCountLabel(count: number): string {
  return count === 1 ? '1 post' : `${count} posts`
}

/**
 * Open or Read-only. "Read-only" is an admin's own setting and wins whatever
 * the plan state, since upgrading does not reopen such a board; "Read-only on
 * the {Plan} plan" is only for a board the plan's board limit alone closes.
 */
function BoardOpenBadge({
  readOnly,
  planReadOnly,
}: {
  readOnly: boolean
  planReadOnly: string | undefined
}) {
  if (!readOnly && planReadOnly === undefined) {
    return (
      <Badge size="sm" variant="success">
        Open
      </Badge>
    )
  }
  return (
    <Badge size="sm" variant="secondary">
      {readOnly || planReadOnly === undefined
        ? 'Read-only'
        : planReadOnly
          ? `Read-only on the ${planReadOnly} plan`
          : 'Read-only by plan limit'}
    </Badge>
  )
}

/** Open and read-only labels show only while some board is read-only. */
export function BoardsList({ boards }: { boards: BoardRow[] }) {
  const anyReadOnly = boards.some((board) => board.readOnly || board.planReadOnly !== undefined)
  return (
    <SettingsList>
      {boards.map((board) => (
        <SettingsListRow
          key={board.id}
          to="/admin/settings/boards/$slug"
          params={{ slug: board.slug }}
          leading={<RowIcon icon={ChatBubbleLeftIcon} />}
          title={board.name}
          badges={
            <>
              <BoardAccessBadge access={board.access} />
              {anyReadOnly && (
                <BoardOpenBadge readOnly={!!board.readOnly} planReadOnly={board.planReadOnly} />
              )}
            </>
          }
          meta={
            board.description
              ? `${board.description} · ${postCountLabel(board.postCount)}`
              : postCountLabel(board.postCount)
          }
        />
      ))}
    </SettingsList>
  )
}
