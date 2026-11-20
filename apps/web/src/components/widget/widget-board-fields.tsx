import { Suspense, useCallback, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { BoardCustomField } from '@/lib/shared/db-types'
import { validatePostCustomFieldValues } from '@/lib/shared/post-custom-fields'
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
 * The answers to the chosen board's fields. `check` runs the rules the server
 * enforces before the post is sent: it marks each missing or bad answer next
 * to its field and says whether the post can go.
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
    if (fields.length === 0) return true
    const parsed = validatePostCustomFieldValues(fields, values)
    if (parsed.ok) return true
    const next: Record<string, string> = {}
    for (const { key } of parsed.errors) {
      const field = fields.find((f) => f.key === key)
      next[key] =
        field && isMissing(field, values[key])
          ? intl.formatMessage({ id: 'widget.home.form.fieldRequired', defaultMessage: 'Required' })
          : intl.formatMessage({
              id: 'widget.home.form.fieldInvalid',
              defaultMessage: 'Check this answer',
            })
    }
    setErrors(next)
    document.getElementById(`board-custom-field-${parsed.errors[0].key}`)?.focus()
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
