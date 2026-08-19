/**
 * Renders a board's configured custom intake fields
 * (boards.settings.customFields) on the public submission form, each in its
 * declared input type. Values are reported upward by field key; the same
 * `validatePostCustomFieldValues` rules the server enforces apply here, so
 * client and server never drift.
 */
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BoardCustomField } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

/**
 * Select fields with at most this many options render as visible one-tap
 * choices; longer lists stay a closed dropdown to keep the form compact.
 */
export const PILL_SELECT_MAX_OPTIONS = 6

export interface BoardCustomFieldsProps {
  fields: BoardCustomField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

export function BoardCustomFields({ fields, values, onChange }: BoardCustomFieldsProps) {
  if (fields.length === 0) return null

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <FieldControl key={field.key} field={field} values={values} onChange={onChange} />
      ))}
    </div>
  )
}

interface FieldControlProps {
  field: BoardCustomField
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

function FieldControl({ field, values, onChange }: FieldControlProps) {
  const id = `board-custom-field-${field.key}`
  const value = values[field.key]

  // Checkboxes carry their label inline (a clickable row), not above the control.
  if (field.type === 'checkbox') {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(field.key, checked === true)}
          aria-label={field.label}
        />
        <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
          {field.label}
          {field.required && <span className="text-destructive ms-0.5">*</span>}
        </Label>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {field.label}
        {field.required && <span className="text-destructive ms-0.5">*</span>}
      </Label>
      {field.type === 'long_text' ? (
        <Textarea
          id={id}
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      ) : field.type === 'number' ? (
        <Input
          id={id}
          type="number"
          value={typeof value === 'number' ? String(value) : ((value as string) ?? '')}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      ) : field.type === 'date' ? (
        <Input
          id={id}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      ) : field.type === 'select' ? (
        <SelectControl field={field} id={id} value={value} onChange={onChange} />
      ) : (
        <Input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}
    </div>
  )
}

interface SelectControlProps {
  field: BoardCustomField
  id: string
  value: unknown
  onChange: (key: string, value: unknown) => void
}

function SelectControl({ field, id, value, onChange }: SelectControlProps) {
  const options = field.options ?? []
  const selected = typeof value === 'string' ? value : undefined

  if (options.length > PILL_SELECT_MAX_OPTIONS) {
    return (
      <Select value={selected} onValueChange={(v) => onChange(field.key, v)}>
        <SelectTrigger id={id} size="sm" className="w-full" aria-label={field.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <div role="radiogroup" aria-label={field.label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const isSelected = option === selected
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(field.key, option)}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
              isSelected
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            )}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
