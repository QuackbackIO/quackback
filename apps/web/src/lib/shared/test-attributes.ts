import { normalizeAttributeKey } from './normalize-attribute-key'

const TEST_ATTRIBUTE_KEYS = ['test', 'onboardingGenerated', 'testOwnerPrincipalId'] as const
const normalizedKeys = new Set(TEST_ATTRIBUTE_KEYS.map(normalizeAttributeKey))

export const RESERVED_TEST_ATTRIBUTE_CODE = 'ATTRIBUTE_RESERVED'
export const RESERVED_TEST_ATTRIBUTE_MESSAGE = 'This attribute is managed by the system'

/** Test markers belong to the server, including legacy registry definitions. */
export function isProtectedTestAttributeKey(key: string): boolean {
  return normalizedKeys.has(normalizeAttributeKey(key))
}

/** Keep caller attributes while discarding server-owned markers. */
export function stripTestAttributes(
  attributes: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(([key]) => !isProtectedTestAttributeKey(key))
  )
}

/** Error serialization may preserve only the message. */
export function isReservedTestAttributeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  return (
    candidate.code === RESERVED_TEST_ATTRIBUTE_CODE ||
    candidate.message === RESERVED_TEST_ATTRIBUTE_MESSAGE
  )
}
