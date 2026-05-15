import { forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from './avatar'

export interface MentionItem {
  principalId: string
  displayName: string
  avatarUrl: string | null
  role: 'admin' | 'member' | 'user'
}

interface MentionPickerProps {
  items: MentionItem[]
  command: (attrs: { id: string; label: string }) => void
}

export interface MentionPickerHandle {
  onKeyDown: (p: { event: KeyboardEvent }) => boolean
}

const roleLabel: Record<MentionItem['role'], string> = {
  admin: 'Admin',
  member: 'Member',
  user: 'Customer',
}

export const MentionPicker = forwardRef<MentionPickerHandle, MentionPickerProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0)

    useEffect(() => setSelected(0), [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelected((i) => (i + items.length - 1) % Math.max(items.length, 1))
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelected((i) => (i + 1) % Math.max(items.length, 1))
          return true
        }
        if (event.key === 'Enter') {
          if (items[selected]) {
            command({
              id: items[selected].principalId,
              label: items[selected].displayName,
            })
            return true
          }
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="mention-picker">
          <div className="mention-picker__empty">No people match.</div>
        </div>
      )
    }

    return (
      <div className="mention-picker" role="listbox">
        {items.map((item, idx) => (
          <button
            key={item.principalId}
            type="button"
            role="option"
            aria-selected={idx === selected}
            className={`mention-picker__row${idx === selected ? ' is-selected' : ''}`}
            onClick={() => command({ id: item.principalId, label: item.displayName })}
            onMouseEnter={() => setSelected(idx)}
          >
            <Avatar className="mention-picker__avatar">
              {item.avatarUrl ? <AvatarImage src={item.avatarUrl} alt={item.displayName} /> : null}
              <AvatarFallback>{item.displayName.charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="mention-picker__name">{item.displayName}</span>
            <span className="mention-picker__role">{roleLabel[item.role]}</span>
          </button>
        ))}
      </div>
    )
  }
)
MentionPicker.displayName = 'MentionPicker'
