/** Turns the API key service's expected errors into refusals a dialog can show. */
import {
  DomainException,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/shared/errors'
import type { ApiKeyRefusal } from '@/lib/shared/api-key-refusal'

/** The refusal for an expected error, or null for anything else (which should throw). */
export function toApiKeyRefusal(error: unknown): ApiKeyRefusal | null {
  if (!(error instanceof DomainException)) return null
  if (error instanceof NotFoundError)
    return { ok: false, code: 'NOT_FOUND', message: error.message }
  if (error instanceof ForbiddenError)
    return { ok: false, code: 'GRANT_CEILING', message: error.message }
  if (error instanceof ValidationError)
    return { ok: false, code: 'INVALID', message: error.message }
  return null
}
