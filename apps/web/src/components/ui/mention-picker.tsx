import { forwardRef, useImperativeHandle, useState, useEffect, useRef } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { CheckBadgeIcon } from '@heroicons/react/24/solid'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'
import { isTeamMember, type Role } from '@/lib/shared/roles'
import { Avatar } from './avatar'
import { ScrollArea } from './scroll-area'

export interface MentionItem {
  principalId: string
  displayName: string
  avatarUrl: string | null
  role: Role
}

interface MentionPickerProps {
  items: MentionItem[]
  command: (attrs: { id: string; label: string }) => void
}

export interface MentionPickerHandle {
  onKeyDown: (p: { event: KeyboardEvent }) => boolean
}

export const MentionPicker = forwardRef<MentionPickerHandle, MentionPickerProps>(
  ({ items, command }, ref) => {
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
    const ctx = useRouteContext({ from: '__root__' }) as {
      settings?: { brandingData?: SettingsBrandingData; name?: string | null }
    }
    const branding = ctx.settings?.brandingData
    const teamBadgeLogoUrl = branding?.logoUrl ?? null
    const teamBadgeLabel = branding?.name ?? ctx.settings?.name ?? 'Team'

    const updateSelected = (next: number) => {
      selectedRef.current = next
      setSelected(next)
    }

    useEffect(() => {
      updateSelected(0)
    }, [items])

    useEffect(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-mention-idx="${selected}"]`)
      row?.scrollIntoView({ block: 'nearest' })
    }, [selected])

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          const current = itemsRef.current
          if (current.length === 0) return false
          const last = current.length - 1
          const cur = selectedRef.current
          if (event.key === 'ArrowUp') {
            updateSelected(cur <= 0 ? last : cur - 1)
            return true
          }
          if (event.key === 'ArrowDown') {
            updateSelected(cur >= last ? 0 : cur + 1)
            return true
          }
          if (event.key === 'Home') {
            updateSelected(0)
            return true
          }
          if (event.key === 'End') {
            updateSelected(last)
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const target = current[cur]
            if (target) {
              commandRef.current({ id: target.principalId, label: target.displayName })
              return true
            }
          }
          return false
        },
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
              {items.map((item, idx) => (
                <button
                  key={item.principalId}
                  type="button"
                  role="option"
                  data-mention-idx={idx}
                  aria-selected={idx === selected}
                  className={`mention-picker__row${idx === selected ? ' is-selected' : ''}`}
                  // preventDefault on mousedown so clicking the picker doesn't
                  // steal focus from the editor and dismiss the suggestion.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => command({ id: item.principalId, label: item.displayName })}
                >
                  <Avatar
                    src={item.avatarUrl}
                    name={item.displayName}
                    className="mention-picker__avatar"
                  />
                  <span className="mention-picker__name">{item.displayName}</span>
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
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    )
  }
)
MentionPicker.displayName = 'MentionPicker'
