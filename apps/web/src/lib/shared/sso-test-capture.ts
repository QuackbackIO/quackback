/**
 * Session- and row-shaped fixture from a Test sign-in.
 * Stored and shown as the admin saw it. Mapping is an administrative
 * choice — this type does not redact claims.
 */

import type { JsonValue } from './json'
import { IDENTITY_SOURCES } from './oidc-claim-mapping'
import type { CapturedIdentity, IdentitySource, SourceUnavailableReason } from './db-types'
import { finishBinding, replayClaimMapping } from './sso-claim-binder'

/** Wire-safe snapshot: JSON values only, no token strings. */
export type SourceSnapshot = {
  source: IdentitySource
  claims?: Record<string, JsonValue>
  unavailable?: SourceUnavailableReason
}

export type SsoTestCapture = {
  version?: 2
  registrationId: string
  capturedAt: string
  detailsChangedAtAtStart?: string | null
  outcome?: 'success' | 'mapping_failed'
  identity?: CapturedIdentity
  claims: Record<string, JsonValue>
  replay?: { sources: SourceSnapshot[] }
}
export type SsoTestCaptureV2 = SsoTestCapture & {
  version: 2
  detailsChangedAtAtStart: string | null
  outcome: 'success' | 'mapping_failed'
  replay: { sources: SourceSnapshot[] }
}
export type { CapturedIdentity }

const UNAVAILABLE: readonly SourceUnavailableReason[] = ['absent', 'unreadable', 'fetch_failed']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseIdentity(value: unknown, required: boolean): CapturedIdentity | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return required ? undefined : undefined
  }
  const sources = isRecord(value.sources) ? (value.sources as CapturedIdentity['sources']) : {}
  const paths = isRecord(value.paths) ? (value.paths as CapturedIdentity['paths']) : undefined
  return {
    id: value.id,
    ...(typeof value.email === 'string' ? { email: value.email } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.image === 'string' ? { image: value.image } : {}),
    sources,
    ...(paths ? { paths } : {}),
  }
}

function parseSourceSnapshot(value: unknown): SourceSnapshot | null {
  if (!isRecord(value) || typeof value.source !== 'string') return null
  if (!(IDENTITY_SOURCES as readonly string[]).includes(value.source)) return null
  const source = value.source as IdentitySource
  if (
    typeof value.unavailable === 'string' &&
    UNAVAILABLE.includes(value.unavailable as SourceUnavailableReason)
  ) {
    return { source, unavailable: value.unavailable as SourceUnavailableReason }
  }
  if (isRecord(value.claims)) {
    return { source, claims: value.claims as Record<string, JsonValue> }
  }
  return null
}

export function isV2Capture(capture: SsoTestCapture): capture is SsoTestCapture & {
  version: 2
  replay: { sources: SourceSnapshot[] }
  outcome: 'success' | 'mapping_failed'
} {
  return capture.version === 2 && Array.isArray(capture.replay?.sources)
}

export function isReplayableCapture(capture: SsoTestCapture): capture is SsoTestCaptureV2 {
  return isV2Capture(capture) && capture.detailsChangedAtAtStart !== undefined
}

/** Claims the binder would accept from this capture, including later sources
 *  that share the bound subject. Exhaustive replay still discards a userinfo
 *  document whose `sub` does not match. */
export function captureSuggestionClaims(capture: SsoTestCapture): Record<string, JsonValue> {
  if (!isV2Capture(capture)) return capture.claims
  const bound = finishBinding(
    replayClaimMapping({ exhaustive: true, wantImage: true }, capture.replay.sources)
  )
  return bound.acceptedClaims as Record<string, JsonValue>
}

/** Caption for a capture that may have no resolved identifier. */
export function captureIdentityCaption(capture: SsoTestCapture): string {
  const identity = capture.identity
  return identity?.email ?? identity?.id ?? 'Not supplied'
}

/** Tolerate a missing or malformed column; never fail a provider list. */
export function parseSsoTestCapture(value: unknown): SsoTestCapture | null {
  if (!isRecord(value)) return null
  if (typeof value.registrationId !== 'string' || typeof value.capturedAt !== 'string') {
    return null
  }
  if (!isRecord(value.claims)) return null

  if (value.version === 2) {
    const identity = value.identity === undefined ? undefined : parseIdentity(value.identity, false)
    if (value.identity !== undefined && !identity) return null
    const replay = isRecord(value.replay) ? value.replay : null
    if (!replay || !Array.isArray(replay.sources)) return null
    const sources: SourceSnapshot[] = []
    for (const entry of replay.sources) {
      const snapshot = parseSourceSnapshot(entry)
      if (!snapshot) return null
      sources.push(snapshot)
    }
    if (value.outcome !== 'success' && value.outcome !== 'mapping_failed') return null
    const detailsChangedAtAtStart =
      value.detailsChangedAtAtStart === null || typeof value.detailsChangedAtAtStart === 'string'
        ? value.detailsChangedAtAtStart
        : null
    return {
      version: 2,
      registrationId: value.registrationId,
      capturedAt: value.capturedAt,
      detailsChangedAtAtStart,
      outcome: value.outcome,
      ...(identity ? { identity } : {}),
      claims: value.claims as Record<string, JsonValue>,
      replay: { sources },
    }
  }

  const identity = parseIdentity(value.identity, true)
  if (!identity) return null
  return {
    registrationId: value.registrationId,
    capturedAt: value.capturedAt,
    identity,
    claims: value.claims as Record<string, JsonValue>,
  }
}
