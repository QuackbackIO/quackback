/**
 * Session- and row-shaped fixture from a successful Test sign-in.
 * Stored and shown as the admin saw it. Mapping is an administrative
 * choice — this type does not redact claims.
 */

import type { JsonValue } from './json'

export interface SsoTestCapture {
  registrationId: string
  capturedAt: string
  identity: {
    id: string
    email?: string
    name?: string
    sources: Partial<Record<'id' | 'email' | 'name', string>>
  }
  claims: Record<string, JsonValue>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tolerate a missing or malformed column; never fail a provider list. */
export function parseSsoTestCapture(value: unknown): SsoTestCapture | null {
  if (!isRecord(value)) return null
  if (typeof value.registrationId !== 'string' || typeof value.capturedAt !== 'string') {
    return null
  }
  if (!isRecord(value.identity) || typeof value.identity.id !== 'string') return null
  if (!isRecord(value.claims)) return null
  const sources = isRecord(value.identity.sources)
    ? (value.identity.sources as SsoTestCapture['identity']['sources'])
    : {}
  return {
    registrationId: value.registrationId,
    capturedAt: value.capturedAt,
    identity: {
      id: value.identity.id,
      ...(typeof value.identity.email === 'string' ? { email: value.identity.email } : {}),
      ...(typeof value.identity.name === 'string' ? { name: value.identity.name } : {}),
      sources,
    },
    claims: value.claims as Record<string, JsonValue>,
  }
}
