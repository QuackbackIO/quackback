import { forwardRef, useImperativeHandle, useState, useEffect, useRef } from 'react'
import { CheckBadgeIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { isTeamMember, type Role } from '@/lib/shared/roles'
import { Avatar } from './avatar'
import { ScrollArea } from './scroll-area'
import { applySuggestionListKey, firstPickableIndex } from './suggestion-list-keys'
import { HighlightQuery } from './highlight-query'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

export interface MentionItem {
  principalId: string
  displayName: string
  avatarUrl: string | null
  role: Role
  /** A teammate who cannot see the item being noted on: shown muted, never picked. */
  noAccess?: boolean
}

const cannotPick = (item: MentionItem) => item.noAccess === true

interface MentionPickerProps {
  items: MentionItem[]
  command: (attrs: { id: string; label: string }) => void
  query?: string
}

export interface MentionPickerHandle {
  onKeyDown: (p: { event: KeyboardEvent }) => boolean
}

export const MentionPicker = forwardRef<MentionPickerHandle, MentionPickerProps>(
  ({ items, command, query = '' }, ref) => {
    const [selected, setSelected] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)
    // Refs shadow state so the imperative handle (empty-deps useImperativeHandle)
    // reads the latest values even when multiple keystrokes fire before React
    // commits a re-render.
    const selectedRef = useRef(0)
    const itemsRef = useRef(items)
    const commandRef = useRef(command)
    itemsRef.current = items
    commandRef.current = command
    const settings = useWorkspaceSettings()
    const branding = settings?.brandingData
    const teamBadgeLogoUrl = branding?.logoUrl ?? null
    const teamBadgeLabel = branding?.name ?? settings?.name ?? 'Team'

    const updateSelected = (next: number) => {
      selectedRef.current = next
      setSelected(next)
    }

    useEffect(() => {
      updateSelected(firstPickableIndex(items, cannotPick))
    }, [items])

    useEffect(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-mention-idx="${selected}"]`)
      row?.scrollIntoView({ block: 'nearest' })
    }, [selected])

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) =>
          applySuggestionListKey(event, {
            items: itemsRef.current,
            selected: selectedRef.current,
            onMove: updateSelected,
            onConfirm: (item) =>
              commandRef.current({ id: item.principalId, label: item.displayName }),
            isDisabled: cannotPick,
          }),
      }),
      []
    )

    return (
      <div className="mention-picker">
        {items.length === 0 ? (
          <div className="mention-picker__empty">No people match.</div>
        ) : (
          <ScrollArea className="mention-picker__scroll">
            <div role="listbox" ref={listRef} className="mention-picker__list">
              {items.map((item, idx) => {
                const blocked = cannotPick(item)
                const isSelected = idx === selected && !blocked
                return (
                  <button
                    key={item.principalId}
                    type="button"
                    role="option"
                    data-mention-idx={idx}
                    aria-selected={isSelected}
                    aria-disabled={blocked || undefined}
                    className={`mention-picker__row${isSelected ? ' is-selected' : ''}${blocked ? ' is-disabled' : ''}`}
                    // preventDefault on mousedown so clicking the picker doesn't
                    // steal focus from the editor and dismiss the suggestion.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (!blocked) command({ id: item.principalId, label: item.displayName })
                    }}
                  >
                    <Avatar
                      src={item.avatarUrl}
                      name={item.displayName}
                      className="mention-picker__avatar"
                    />
                    <span className="mention-picker__name">
                      <HighlightQuery text={item.displayName} query={query} />
                    </span>
                    {isTeamMember(item.role) && (
                      <span
                        className="mention-picker__team-badge"
                        aria-label={`${teamBadgeLabel} Member`}
                        title={`${teamBadgeLabel} Member`}
                      >
                        {teamBadgeLogoUrl ? (
                          <img
                            src={teamBadgeLogoUrl}
                            alt=""
                            className="mention-picker__team-badge-img"
                          />
                        ) : (
                          <CheckBadgeIcon className="mention-picker__team-badge-icon" />
                        )}
                      </span>
                    )}
                    {blocked && (
                      <span className="mention-picker__no-access">
                        <LockClosedIcon className="mention-picker__lock" aria-hidden />
                        No access
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    )
  }
)
MentionPicker.displayName = 'MentionPicker'
