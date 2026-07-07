/**
 * The inbox detail panel's Attributes section: one typed inline editor per
 * live definition, for a conversation OR a ticket (unified inbox §3.5). Every
 * edit goes through the single teammate write path
 * (setConversationAttributeValueFn), which stores a { v, src: 'teammate', at }
 * envelope. Renders nothing while no definitions exist so the panel stays
 * clean for workspaces that haven't adopted attributes.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId, TicketId } from '@quackback/ids'
import { setConversationAttributeValueFn } from '@/lib/server/functions/conversation-attributes'
import {
  conversationAttributeQueries,
  type ConversationAttributeItem,
} from '@/lib/client/queries/conversation-attributes'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { ticketKeys } from '@/lib/client/queries/inbox'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'

/** The dual target this editor writes to — mirrors SetAttributeTarget. */
export type ConversationAttributesEditorTarget =
  | { conversationId: ConversationId }
  | { ticketId: TicketId }
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DetailRow as Row } from '@/components/shared/detail-row'

const NONE = '__none__'

/** Human hint for where the current value came from. */
function provenanceTitle(raw: unknown): string | undefined {
  const src = readAttributeValue(raw)?.src
  return src ? `Set by ${src}` : undefined
}

/** Commit-on-blur/Enter text or number input (avoids a write per keystroke). */
function InlineValueInput({
  type,
  value,
  onCommit,
}: {
  type: 'text' | 'number'
  value: string
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Re-sync when another writer (workflow, another agent) changes the value.
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <Input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      className="h-7 w-36 text-right text-sm"
    />
  )
}

function AttributeEditor({
  definition,
  raw,
  onSet,
}: {
  definition: ConversationAttributeItem
  raw: unknown
  onSet: (value: unknown) => void
}) {
  const value = readAttributeValue(raw)?.v
  switch (definition.fieldType) {
    case 'text':
      return (
        <InlineValueInput
          type="text"
          value={typeof value === 'string' ? value : ''}
          onCommit={(next) => onSet(next.trim() === '' ? null : next)}
        />
      )
    case 'number':
      return (
        <InlineValueInput
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onCommit={(next) => onSet(next.trim() === '' ? null : Number(next))}
        />
      )
    case 'checkbox':
      return <Switch checked={value === true} onCheckedChange={(checked) => onSet(checked)} />
    case 'date':
      return (
        <Input
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => onSet(e.target.value === '' ? null : e.target.value)}
          className="h-7 w-36 text-sm"
        />
      )
    case 'select': {
      const options = definition.options ?? []
      return (
        <Select
          value={typeof value === 'string' && value !== '' ? value : NONE}
          onValueChange={(next) => onSet(next === NONE ? null : next)}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id} title={o.description ?? undefined}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    case 'multi_select': {
      const options = definition.options ?? []
      const selected = Array.isArray(value) ? (value as string[]) : []
      const labels = options.filter((o) => selected.includes(o.id)).map((o) => o.label)
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 max-w-40 items-center gap-1 rounded-md px-2 text-sm hover:bg-muted"
            >
              <span className="truncate">{labels.length > 0 ? labels.join(', ') : 'None'}</span>
              <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {options.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.id}
                checked={selected.includes(o.id)}
                onCheckedChange={(checked) =>
                  onSet(checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))
                }
                onSelect={(e) => e.preventDefault()}
              >
                {o.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  }
}

export function ConversationAttributesEditor({
  target,
  customAttributes,
  onChanged,
  enabled = true,
}: {
  target: ConversationAttributesEditorTarget
  customAttributes: Record<string, unknown>
  onChanged: () => void
  /** Skip fetching while the panel is hidden (mirrors the sibling queries). */
  enabled?: boolean
}) {
  const queryClient = useQueryClient()
  const { data: definitions } = useQuery({
    ...conversationAttributeQueries.live(),
    enabled,
  })

  const setValue = useMutation({
    mutationFn: (input: { key: string; value: unknown }) =>
      setConversationAttributeValueFn({ data: { ...target, ...input } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey:
          'conversationId' in target
            ? conversationKeys.agentThread(target.conversationId)
            : ticketKeys.detail(target.ticketId),
      })
      onChanged()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to update attribute'),
  })

  if (!definitions || definitions.length === 0) return null

  return (
    <div className="space-y-4 border-t border-border/30 pt-4">
      <span className="text-sm text-muted-foreground">Attributes</span>
      <div className="border-t border-border/30" />
      {definitions.map((def) => {
        const raw = customAttributes[def.key]
        const isAiSet = readAttributeValue(raw)?.src === 'ai'
        return (
          <div key={def.id} title={isAiSet ? undefined : provenanceTitle(raw)}>
            <Row label={def.label} align="center">
              <div className="flex items-center gap-1.5">
                {isAiSet && (
                  <Badge
                    variant="secondary"
                    className="h-5 border border-indigo-500/20 bg-indigo-500/10 px-1.5 text-[10px] text-indigo-600"
                    title="Set by AI"
                  >
                    AI
                  </Badge>
                )}
                <AttributeEditor
                  definition={def}
                  raw={raw}
                  onSet={(value) => setValue.mutate({ key: def.key, value })}
                />
              </div>
            </Row>
          </div>
        )
      })}
    </div>
  )
}
