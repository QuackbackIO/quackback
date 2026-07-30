/**
 * Board custom intake fields (boards.settings.customFields): client-safe
 * validation of submitted values against a board's declared field set.
 *
 * No server/db imports — the public submission form (inline validation) and
 * the createPost write path both run this, so the two never drift. Mirrors
 * the ticket intake-form validator contract for the same reason.
 *
 * Only declared field keys are accepted; any other key in `values` is
 * dropped, never trusted (an unknown key can't be smuggled into the post's
 * customFieldValues column). Per-type rules: a required field must be present
 * and non-empty; `select` must be one of its `options`; `number` must be
 * finite; `date` must be an ISO date; `checkbox` must be a boolean. Coerces
 * to the field's canonical stored type.
 */
import type { BoardCustomField, CustomFieldValues } from '@/lib/shared/db-types'

/** Upper bound on a stored text/long_text answer. Answers land in the post's
 *  customFieldValues JSON, so — like the 10,000-char content cap — a bound
 *  keeps an anonymous submitter from writing unbounded blobs into the
 *  column. */
export const POST_CUSTOM_FIELD_TEXT_MAX_LENGTH = 4000

/** One field-level validation failure from `validatePostCustomFieldValues`. */
export interface PostCustomFieldError {
  key: string
  message: string
}

export function validatePostCustomFieldValues(
  fields: BoardCustomField[],
  values: Record<string, unknown>
): { ok: true; values: CustomFieldValues } | { ok: false; errors: PostCustomFieldError[] } {
  const errors: PostCustomFieldError[] = []
  const cleaned: CustomFieldValues = {}

  for (const field of fields) {
    const raw = values[field.key]
    const missing =
      raw === undefined || raw === null || (typeof raw === 'string' && raw.trim().length === 0)

    if (missing) {
      if (field.required && field.type !== 'checkbox') {
        errors.push({ key: field.key, message: `${field.label} is required` })
      }
      // A required checkbox means "must be checked" — handled in its case below.
      if (field.type !== 'checkbox') continue
    }

    switch (field.type) {
      case 'text':
      case 'long_text': {
        const str = typeof raw === 'string' ? raw : String(raw ?? '')
        if (str.length > POST_CUSTOM_FIELD_TEXT_MAX_LENGTH) {
          errors.push({
            key: field.key,
            message: `${field.label} must be ${POST_CUSTOM_FIELD_TEXT_MAX_LENGTH} characters or less`,
          })
          break
        }
        cleaned[field.key] = str
        break
      }
      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isFinite(num)) {
          errors.push({ key: field.key, message: `${field.label} must be a number` })
          break
        }
        cleaned[field.key] = num
        break
      }
      case 'select': {
        const str = typeof raw === 'string' ? raw : String(raw ?? '')
        if (!(field.options ?? []).includes(str)) {
          errors.push({ key: field.key, message: `${field.label} is not a valid option` })
          break
        }
        cleaned[field.key] = str
        break
      }
      case 'date': {
        const str = typeof raw === 'string' ? raw : ''
        // ISO date (YYYY-MM-DD) or full ISO datetime; must parse to a real date.
        if (!/^\d{4}-\d{2}-\d{2}/.test(str) || Number.isNaN(Date.parse(str))) {
          errors.push({ key: field.key, message: `${field.label} must be a valid date` })
          break
        }
        cleaned[field.key] = str
        break
      }
      case 'checkbox': {
        const bool = raw === true || raw === 'true'
        if (field.required && !bool) {
          errors.push({ key: field.key, message: `${field.label} is required` })
          break
        }
        cleaned[field.key] = bool
        break
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, values: cleaned }
}
