/**
 * Shared renderer for a ticket type's custom fields (convergence Phase 4):
 * the controlled field set the agent create dialog, the portal New-Ticket
 * form, and the Messenger New-Ticket form all render from a type's
 * `fields[]`. Pure display + per-key change callbacks; validation runs through
 * the shared `validateTicketIntakeValues` in each surface's submit path, so
 * the three never drift.
 */
import { useIntl } from 'react-intl'
import type { ReactNode } from 'react'
import type { TicketFormField } from '@/lib/shared/tickets'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface TicketFormFieldsProps {
  fields: TicketFormField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  /** Per-key validation messages (from validateTicketIntakeValues). */
  errors?: Record<string, string>
  /** Convergence Phase 5 (create-dialog auto-fill): keys whose current value
   *  came from the copilot's suggestion — rendered with a "✨ suggested"
   *  marker. Omit on the intake surfaces (no suggestions exist there). */
  suggestedKeys?: ReadonlySet<string>
  /** Whether a suggestion run completed; with `suggestedKeys`, unmarked keys
   *  render the muted "not suggested" state (they stay empty). */
  suggestionRun?: boolean
}

/** The per-field suggestion provenance hint (Phase 5): the ✨ marker a
 *  suggested value carries, or the muted not-suggested state once a run
 *  completed without answering this field. Null on surfaces without
 *  suggestions (both props omitted). */
function suggestionMarker(
  field: TicketFormField,
  suggestedKeys: ReadonlySet<string> | undefined,
  suggestionRun: boolean | undefined
): ReactNode {
  if (suggestedKeys?.has(field.key)) {
    return <span className="ms-1 font-normal text-primary">✨ suggested</span>
  }
  if (suggestionRun) {
    return <span className="ms-1 font-normal text-muted-foreground/70">— not suggested</span>
  }
  return null
}

function FieldLabel({ field, marker }: { field: TicketFormField; marker?: ReactNode }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {field.label}
      {field.required && <span className="ms-0.5 text-destructive">*</span>}
      {marker}
    </label>
  )
}

export function TicketFormFields({
  fields,
  values,
  onChange,
  errors,
  suggestedKeys,
  suggestionRun,
}: TicketFormFieldsProps) {
  const intl = useIntl()
  if (fields.length === 0) return null
  return (
    <>
      {fields.map((field) => {
        const marker = suggestionMarker(field, suggestedKeys, suggestionRun)
        return (
          <div key={field.key} className="space-y-1.5">
            {field.type !== 'checkbox' && <FieldLabel field={field} marker={marker} />}
            {field.type === 'text' && (
              <Input
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
            {field.type === 'long_text' && (
              <Textarea
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                rows={3}
              />
            )}
            {field.type === 'number' && (
              <Input
                type="number"
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
            {field.type === 'date' && (
              <Input
                type="date"
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
            {field.type === 'select' && (
              <Select
                value={(values[field.key] as string) ?? ''}
                onValueChange={(v) => onChange(field.key, v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={intl.formatMessage({
                      id: 'tickets.fields.selectPlaceholder',
                      defaultMessage: 'Select…',
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {field.type === 'checkbox' && (
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={values[field.key] === true}
                  onCheckedChange={(v) => onChange(field.key, v === true)}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {field.label}
                  {field.required && <span className="ms-0.5 text-destructive">*</span>}
                  {marker}
                </span>
              </label>
            )}
            {errors?.[field.key] && (
              <p className="text-[11px] text-destructive">{errors[field.key]}</p>
            )}
          </div>
        )
      })}
    </>
  )
}
