/**
 * Actions builder for routing rules. Each action is `{type, value: string}`
 * where the value is an entity id (inbox/team/principal) or an enum value
 * (priority/visibility).
 */
import type { InboxId, TeamId, PrincipalId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TrashIcon, PlusIcon } from '@heroicons/react/24/outline'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { PrincipalPicker } from '@/components/admin/shared/principal-picker'

const ACTION_TYPES = [
  'assignToInbox',
  'assignToTeam',
  'assignToPrincipal',
  'setPriority',
  'setVisibility',
  'addParticipant',
] as const
type ActionType = (typeof ACTION_TYPES)[number]

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const VISIBILITY = ['team', 'org', 'shared', 'private'] as const

const TYPE_LABELS: Record<ActionType, string> = {
  assignToInbox: 'Assign to inbox',
  assignToTeam: 'Assign to team',
  assignToPrincipal: 'Assign to principal',
  setPriority: 'Set priority',
  setVisibility: 'Set visibility',
  addParticipant: 'Add participant',
}

export interface BuilderAction {
  type: ActionType
  value: string
}

interface Props {
  value: BuilderAction[]
  onChange: (next: BuilderAction[]) => void
}

export function RoutingActionsBuilder({ value, onChange }: Props) {
  const update = (idx: number, patch: Partial<BuilderAction>) => {
    onChange(
      value.map((a, i) => {
        if (i !== idx) return a
        const merged = { ...a, ...patch }
        if (patch.type !== undefined && patch.type !== a.type) {
          merged.value = ''
        }
        return merged
      })
    )
  }
  const add = () => onChange([...value, { type: 'assignToInbox', value: '' }])
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      {value.map((a, idx) => (
        <div key={idx} className="grid grid-cols-[200px_1fr_auto] gap-2 items-start">
          <Select value={a.type} onValueChange={(v) => update(idx, { type: v as ActionType })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ActionValueInput
            type={a.type}
            value={a.value}
            onChange={(v) => update(idx, { value: v })}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => remove(idx)}
            aria-label="Remove action"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <PlusIcon className="h-3.5 w-3.5 mr-1" />
        Add action
      </Button>
    </div>
  )
}

function ActionValueInput({
  type,
  value,
  onChange,
}: {
  type: ActionType
  value: string
  onChange: (v: string) => void
}) {
  switch (type) {
    case 'assignToInbox':
      return (
        <InboxPicker
          value={(value as InboxId) || null}
          onValueChange={(v) => onChange((v as string) ?? '')}
          allowClear
          placeholder="Pick inbox…"
        />
      )
    case 'assignToTeam':
      return (
        <TeamPicker
          value={(value as TeamId) || null}
          onValueChange={(v) => onChange((v as string) ?? '')}
          allowClear
          placeholder="Pick team…"
        />
      )
    case 'assignToPrincipal':
    case 'addParticipant':
      return (
        <PrincipalPicker
          value={(value as PrincipalId) || null}
          onValueChange={(v) => onChange((v as string) ?? '')}
          placeholder="Pick principal…"
        />
      )
    case 'setPriority':
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Pick priority…" />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'setVisibility':
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Pick visibility…" />
          </SelectTrigger>
          <SelectContent>
            {VISIBILITY.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
  }
}
