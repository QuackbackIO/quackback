/**
 * Expected refusals from the API key server functions, returned as values so
 * the dialogs can show them (a typed error thrown from a server function
 * reaches the browser without its code).
 */
export const API_KEY_REFUSAL_CODES = [
  'NOT_FOUND',
  'GRANT_CEILING',
  'POLICY_OFF',
  'INVALID',
] as const

export type ApiKeyRefusalCode = (typeof API_KEY_REFUSAL_CODES)[number]

export interface ApiKeyRefusal {
  ok: false
  code: ApiKeyRefusalCode
  message: string
}

/** How long a new personal key lasts. */
export const PERSONAL_KEY_EXPIRY_CHOICES = ['30d', '90d', '1y', 'never'] as const

export type PersonalKeyExpiry = (typeof PERSONAL_KEY_EXPIRY_CHOICES)[number]

export const DEFAULT_PERSONAL_KEY_EXPIRY: PersonalKeyExpiry = '90d'

const EXPIRY_DAYS: Record<Exclude<PersonalKeyExpiry, 'never'>, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
}

/** When a key made at `from` with this choice stops working; null for no expiry. */
export function personalKeyExpiresAt(choice: PersonalKeyExpiry, from = new Date()): Date | null {
  if (choice === 'never') return null
  return new Date(from.getTime() + EXPIRY_DAYS[choice] * 24 * 60 * 60 * 1000)
}
