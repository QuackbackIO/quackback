/**
 * Reading what a REST caller sent: the JSON body and the paging parameters.
 * Input the caller got wrong throws a ValidationError, which every route's
 * handleDomainError answers with a 400, never a 500.
 */
import { ValidationError } from '@/lib/shared/errors'

/**
 * The request body parsed as JSON, or undefined when there is no body (the
 * route's schema then says what was missing).
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new ValidationError('VALIDATION_ERROR', 'Request body must be valid JSON')
  }
}

/** A query parameter that must be a whole number of at least `min`, or absent. */
function wholeNumberParam(url: URL, name: string, min: number): number | undefined {
  const raw = url.searchParams.get(name)
  if (raw === null || raw === '') return undefined
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `${name} must be a whole number of ${min} or more`
    )
  }
  return Number(raw)
}

/** `?limit=`: a whole number from 1, `fallback` when absent, capped at `max`. */
export function parseLimit(url: URL, { fallback = 20, max = 100 } = {}): number {
  return Math.min(wholeNumberParam(url, 'limit', 1) ?? fallback, max)
}

/** `?offset=`: a whole number from 0, 0 when absent. */
export function parseOffset(url: URL): number {
  return wholeNumberParam(url, 'offset', 0) ?? 0
}
