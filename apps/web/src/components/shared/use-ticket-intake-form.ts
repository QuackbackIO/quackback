/**
 * The intake-form state behind `TicketFormFields` (convergence Phase 4): type
 * selection, draft answers, and per-key errors, plus the swap/reset rules the
 * agent create dialog, the portal New-Ticket form, and the Messenger
 * New-Ticket form all share — one implementation so the three never drift.
 *
 * Default selection rule (the intake surfaces): an explicit pick wins; else
 * the workspace default type; else the only offered type. The agent dialog
 * resolves differently (category-aware preselection, no implicit fallback —
 * it manages `selectedTypeId` through its open effects) and passes its own
 * `resolveSelectedType`.
 *
 * Validation runs through the shared `validateTicketIntakeValues`; pass
 * `includeInternal` on the AGENT path (the create dialog fills the type's
 * full field set, customer-hidden fields included).
 */
import { useCallback, useMemo, useState } from 'react'
import {
  validateTicketIntakeValues,
  type TicketFormField,
  type TicketIntakeError,
} from '@/lib/shared/tickets'

/** The shape the hook needs from an offered type (TicketIntakeType and
 *  TicketTypeDTO both satisfy it). */
export interface TicketIntakeFormType {
  id: string
  isDefault: boolean
  fields: TicketFormField[]
}

/** The intake-surface selection rule: the explicit pick, else the workspace
 *  default, else the only offered type. */
function defaultResolveSelectedType<T extends TicketIntakeFormType>(
  types: T[],
  selectedTypeId: string | null
): T | null {
  return (
    types.find((t) => t.id === selectedTypeId) ??
    types.find((t) => t.isDefault) ??
    (types.length === 1 ? types[0] : null) ??
    null
  )
}

export interface UseTicketIntakeFormOptions<T extends TicketIntakeFormType> {
  /** Override how the effective selection resolves from `selectedTypeId`. */
  resolveSelectedType?: (types: T[], selectedTypeId: string | null) => T | null
  /** Agent path: validate the type's full field set (internal fields too). */
  includeInternal?: boolean
}

export function useTicketIntakeForm<T extends TicketIntakeFormType>(
  types: T[],
  opts?: UseTicketIntakeFormOptions<T>
) {
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const selectedType = (opts?.resolveSelectedType ?? defaultResolveSelectedType)(
    types,
    selectedTypeId
  )
  // Order-sorted for rendering + validation (the intake DTOs arrive sorted;
  // the agent dialog's registry types are sorted client-side — a stable sort
  // over an already-sorted list is a no-op).
  const fields = useMemo(
    () => [...(selectedType?.fields ?? [])].sort((a, b) => a.order - b.order),
    [selectedType]
  )

  /** Write one answer and drop its stale inline error, if any. */
  const setFieldValue = useCallback((key: string, value: unknown) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  /** Type swap: change the field set and drop the old type's draft answers. */
  const selectType = useCallback((id: string) => {
    setSelectedTypeId(id)
    setFieldValues({})
    setFieldErrors({})
  }, [])

  /** A fresh form: no explicit pick, no answers, no errors. */
  const reset = useCallback(() => {
    setSelectedTypeId(null)
    setFieldValues({})
    setFieldErrors({})
  }, [])

  /** Inline-validate the current answers (the same validator the server
   *  enforces); on failure the per-key messages land in `fieldErrors`. */
  const validate = (): { ok: true; values: Record<string, unknown> } | { ok: false } => {
    const result = validateTicketIntakeValues(fields, fieldValues, {
      includeInternal: opts?.includeInternal,
    })
    if (!result.ok) {
      setFieldErrors(
        result.errors.reduce<Record<string, string>>((acc, e: TicketIntakeError) => {
          acc[e.key] = e.message
          return acc
        }, {})
      )
      return { ok: false }
    }
    return { ok: true, values: result.values }
  }

  return {
    selectedTypeId,
    selectedType,
    fields,
    fieldValues,
    fieldErrors,
    setSelectedTypeId,
    setFieldValues,
    setFieldErrors,
    setFieldValue,
    selectType,
    reset,
    validate,
  }
}
