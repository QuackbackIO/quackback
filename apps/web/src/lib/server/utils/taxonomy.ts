import { ValidationError } from '@/lib/shared/errors'
import { HEX_COLOR_PATTERN } from '@/lib/shared/schemas/taxonomy'

/**
 * Trim a taxonomy (or similarly bounded) display name and reject empty / too-long
 * values. Messages stay at the call site — they are observable API behaviour
 * and differ per entity ("PostTag name is required" vs "Name is required").
 */
export function assertTrimmedName(
  raw: string | undefined,
  messages: { required: string; tooLong: string },
  maxLength = 50
): string {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) {
    throw new ValidationError('VALIDATION_ERROR', messages.required)
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError('VALIDATION_ERROR', messages.tooLong)
  }
  return trimmed
}

/** Reject a color that is not `#rrggbb`. Message stays at the call site. */
export function assertHexColor(color: string, message: string): string {
  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new ValidationError('VALIDATION_ERROR', message)
  }
  return color
}
