import { Suspense, useCallback, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { BoardCustomField } from '@/lib/shared/db-types'
import { lazyOptional } from '@/lib/client/lazy-with-preload'

/**
 * A board's custom fields in the widget composer. The controls are the portal
 * composer's, loaded only when the chosen board declares fields, so the
 * widget's first load stays as it was for every other board.
 */
const BoardCustomFields = lazyOptional(
  () => import('@/components/public/feedback/board-custom-fields'),
  'BoardCustomFields'
)

const NO_FIELDS: BoardCustomField[] = []

function isMissing(field: BoardCustomField, raw: unknown): boolean {
  if (field.type === 'checkbox') return raw !== true && raw !== 'true'
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
}

/**
 * The answers to the chosen board's fields. `check` marks each missing
 * required answer next to its field and says whether the post can go.
 */
export function useBoardFieldAnswers(
  fields: BoardCustomField[] = NO_FIELDS,
  boardId: string | undefined
) {
  const intl = useIntl()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const reset = useCallback(() => {
    setValues({})
    setErrors({})
  }, [])
  // Answers belong to the board they were written for.
  useEffect(reset, [boardId, reset])

  const onChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setErrors(({ [key]: _answered, ...rest }) => rest)
  }, [])

  function check(): boolean {
    // Only the required check runs here: the shared validator would become a
    // chunk of its own on the widget's first load. The server still checks
    // every rule.
    const missing = fields.filter((f) => f.required && isMissing(f, values[f.key]))
    if (missing.length === 0) return true
    const required = intl.formatMessage({
      id: 'widget.home.form.fieldRequired',
      defaultMessage: 'Required',
    })
    setErrors(Object.fromEntries(missing.map((f) => [f.key, required])))
    document.getElementById(`board-custom-field-${missing[0].key}`)?.focus()
    return false
  }

  return {
    fields,
    values,
    errors,
    onChange,
    check,
    reset,
    /** What the post sends: the answers, only for a board that asks for any. */
    payload: fields.length > 0 ? { customFields: values } : {},
  }
}

export function WidgetBoardFields({
  answers,
}: {
  answers: ReturnType<typeof useBoardFieldAnswers>
}) {
  if (answers.fields.length === 0) return null
  return (
    <div className="px-3 pb-2">
      <Suspense fallback={null}>
        <BoardCustomFields
          fields={answers.fields}
          values={answers.values}
          errors={answers.errors}
          onChange={answers.onChange}
        />
      </Suspense>
    </div>
  )
}
