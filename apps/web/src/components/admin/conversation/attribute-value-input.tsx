/**
 * Typed value input for a conversation attribute, driven by its definition:
 * text/number/date inputs, a checkbox switch, and option pickers for
 * select/multi_select (option IDS are the stored values). Shared by the macro
 * editor and the workflow canvas so both author the same JSON the domain
 * writer validates. Emits null for "no value" (the writer treats it as unset).
 */
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import type { ConversationAttributeItem } from '@/lib/client/queries/conversation-attributes'
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
import { cn } from '@/lib/shared/utils'

const NONE = '__none__'

/** The JSON value shapes the input emits (null = no value / unset). */
export type AttributeInputValue = string | number | boolean | string[] | null

export function AttributeValueInput({
  definition,
  value,
  onChange,
  className,
}: {
  definition: Pick<ConversationAttributeItem, 'fieldType' | 'options'>
  value: unknown
  onChange: (value: AttributeInputValue) => void
  className?: string
}) {
  switch (definition.fieldType) {
    case 'text':
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          placeholder="Value"
          className={cn('h-8 text-sm', className)}
        />
      )
    case 'number':
      return (
        <Input
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="0"
          className={cn('h-8 text-sm', className)}
        />
      )
    case 'checkbox':
      return (
        <div className={cn('flex h-8 items-center', className)}>
          <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        </div>
      )
    case 'date':
      return (
        <Input
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className={cn('h-8 text-sm', className)}
        />
      )
    case 'select': {
      const options = definition.options ?? []
      return (
        <Select
          value={typeof value === 'string' && value !== '' ? value : NONE}
          onValueChange={(next) => onChange(next === NONE ? null : next)}
        >
          <SelectTrigger size="sm" className={cn('text-sm', className)}>
            <SelectValue placeholder="Choose value" />
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
              className={cn(
                'inline-flex h-8 items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs hover:bg-muted',
                className
              )}
            >
              <span className="truncate">
                {labels.length > 0 ? labels.join(', ') : 'Choose values'}
              </span>
              <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {options.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.id}
                checked={selected.includes(o.id)}
                onCheckedChange={(checked) => {
                  const next = checked ? [...selected, o.id] : selected.filter((id) => id !== o.id)
                  onChange(next.length === 0 ? null : next)
                }}
                onSelect={(e) => e.preventDefault()}
              >
                {o.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    default:
      return null
  }
}
