/**
 * Pure source-aware identity binder. Production, the SSO test, and browser
 * replay share these transitions; token decoding and userinfo fetch stay on
 * the server adapter.
 */

import {
  DEFAULT_IDENTITY_SOURCES,
  claimPathIsUnsafe,
  getClaimByPath,
  isAffirmativeClaim,
  type IdentitySource,
  type SourceSnapshot,
  type SourceUnavailableReason,
} from './oidc-claim-mapping'

export type IdentityMapping = {
  sources?: IdentitySource[]
  idClaim?: string
  nameClaim?: string
  emailClaim?: string
  imageClaim?: string
}

export type BindingConfig = {
  mapping?: IdentityMapping
  requiredClaimPaths?: readonly string[]
  wantImage?: boolean
  exhaustive?: boolean
  subjectMismatch?: 'observe' | 'enforce'
}

export type ResolveWarning = 'subject_mismatch'

export type FieldProvenance = { source: IdentitySource; path: string }

export type BindingIdentity = {
  id?: string
  email?: string
  name?: string
  image?: string
  emailVerified: boolean
}

export type BindingState = {
  config: ResolvedBindingConfig
  identity: BindingIdentity
  provenance: Partial<Record<'id' | 'email' | 'name' | 'image', FieldProvenance>>
  acceptedClaims: Record<string, unknown>
  warnings: ResolveWarning[]
  sourceAvailability: Partial<Record<IdentitySource, 'available' | SourceUnavailableReason>>
  failed?: 'subject_mismatch'
}

export type ResolvedBindingConfig = {
  sources: IdentitySource[]
  idClaim: string
  emailClaim: string
  nameClaim: string
  imageClaim: string
  explicitIdClaim: boolean
  requiredClaimPaths?: readonly string[]
  wantImage: boolean
  exhaustive: boolean
  subjectMismatch: 'observe' | 'enforce'
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** Same missing-value rule as `planClaimAttributeWrites`. */
export function claimIsMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

export function asHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

function requiredPathsResolved(
  merged: Record<string, unknown>,
  paths: readonly string[] | undefined
): boolean {
  if (!paths?.length) return true
  return paths.every((path) => !claimIsMissing(getClaimByPath(merged, path)))
}

function setClaimByPath(
  claims: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const segments = path.split('.')
  if (claimPathIsUnsafe(path)) return claims
  if (Object.hasOwn(claims, path) || path.includes('://') || segments.length === 1) {
    return { ...claims, [path]: value }
  }
  const root = { ...claims }
  let current: Record<string, unknown> = root
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const existing = Object.hasOwn(current, segment) ? current[segment] : undefined
    const child: Record<string, unknown> =
      existing !== null && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}
    current[segment] = child
    current = child
  }
  current[segments[segments.length - 1]] = value
  return root
}

function fillRequiredLeaves(
  merged: Record<string, unknown>,
  source: Record<string, unknown>,
  paths: readonly string[] | undefined
): Record<string, unknown> {
  if (!paths?.length) return merged
  let next = merged
  for (const path of paths) {
    if (!claimIsMissing(getClaimByPath(next, path))) continue
    const incoming = getClaimByPath(source, path)
    if (claimIsMissing(incoming)) continue
    next = setClaimByPath(next, path, cloneJson(incoming))
  }
  return next
}

function mergeAcceptedClaims(
  accepted: Record<string, unknown>,
  incoming: Record<string, unknown>,
  requiredClaimPaths: readonly string[] | undefined
): Record<string, unknown> {
  const next = { ...accepted }
  for (const [key, value] of Object.entries(incoming)) {
    if (!Object.hasOwn(next, key)) next[key] = cloneJson(value)
  }
  return fillRequiredLeaves(next, incoming, requiredClaimPaths)
}

function claimedIdForSource(
  claims: Record<string, unknown>,
  source: IdentitySource,
  config: ResolvedBindingConfig
): { value: string; path: string } | undefined {
  const mapped = asNonEmptyString(getClaimByPath(claims, config.idClaim))
  if (mapped) return { value: mapped, path: config.idClaim }
  if (source === 'userinfo' && !config.explicitIdClaim) {
    const fallback = asNonEmptyString(getClaimByPath(claims, 'id'))
    if (fallback) return { value: fallback, path: 'id' }
  }
  return undefined
}

function identityFieldsComplete(identity: BindingIdentity): boolean {
  return Boolean(identity.id && identity.email && identity.name)
}

export function createBindingState(config: BindingConfig = {}): BindingState {
  const mapping = config.mapping
  return {
    config: {
      sources: mapping?.sources ?? DEFAULT_IDENTITY_SOURCES,
      idClaim: mapping?.idClaim ?? 'sub',
      emailClaim: mapping?.emailClaim ?? 'email',
      nameClaim: mapping?.nameClaim ?? 'name',
      imageClaim: mapping?.imageClaim ?? 'picture',
      explicitIdClaim: Boolean(mapping?.idClaim),
      requiredClaimPaths: config.requiredClaimPaths,
      wantImage: config.wantImage === true,
      exhaustive: config.exhaustive === true,
      subjectMismatch: config.subjectMismatch ?? 'observe',
    },
    identity: { emailVerified: false },
    provenance: {},
    acceptedClaims: {},
    warnings: [],
    sourceAvailability: {},
  }
}

export function bindingComplete(state: BindingState): boolean {
  if (state.failed) return false
  const { identity, config, acceptedClaims } = state
  return (
    identityFieldsComplete(identity) &&
    (!config.wantImage || Boolean(identity.image)) &&
    requiredPathsResolved(acceptedClaims, config.requiredClaimPaths)
  )
}

function emptyIdentity(): BindingIdentity {
  return { emailVerified: false }
}

export function advanceBindingState(
  state: BindingState,
  source: IdentitySource,
  claims: Record<string, unknown> | null,
  unavailable?: SourceUnavailableReason
): BindingState {
  if (state.failed) return state
  if (!claims) {
    return {
      ...state,
      sourceAvailability: {
        ...state.sourceAvailability,
        [source]: unavailable ?? 'absent',
      },
    }
  }

  const incoming = cloneJson(claims)
  const config = state.config
  const identityComplete = identityFieldsComplete(state.identity)
  const claimed = claimedIdForSource(incoming, source, config)

  if (
    source === 'userinfo' &&
    state.identity.id &&
    claimed &&
    claimed.value !== state.identity.id
  ) {
    if (config.subjectMismatch === 'enforce') {
      return {
        ...state,
        sourceAvailability: { ...state.sourceAvailability, [source]: 'available' },
        warnings: state.warnings.includes('subject_mismatch')
          ? state.warnings
          : [...state.warnings, 'subject_mismatch'],
        failed: 'subject_mismatch',
      }
    }
    if (identityComplete) {
      return {
        ...state,
        sourceAvailability: { ...state.sourceAvailability, [source]: 'available' },
        warnings: state.warnings.includes('subject_mismatch')
          ? state.warnings
          : [...state.warnings, 'subject_mismatch'],
      }
    }
    state = {
      ...state,
      identity: emptyIdentity(),
      provenance: {},
      acceptedClaims: {},
      warnings: state.warnings.includes('subject_mismatch')
        ? state.warnings
        : [...state.warnings, 'subject_mismatch'],
    }
  }

  const acceptedClaims = mergeAcceptedClaims(
    state.acceptedClaims,
    incoming,
    config.requiredClaimPaths
  )
  const identity = { ...state.identity }
  const provenance = { ...state.provenance }

  if (!identity.id && claimed) {
    identity.id = claimed.value
    provenance.id = { source, path: claimed.path }
  }
  if (!identity.name) {
    const claimedName = asNonEmptyString(getClaimByPath(incoming, config.nameClaim))
    if (claimedName) {
      identity.name = claimedName
      provenance.name = { source, path: config.nameClaim }
    }
  }
  if (!identity.email) {
    const claimedEmail = asNonEmptyString(getClaimByPath(incoming, config.emailClaim))
    if (claimedEmail) {
      identity.email = claimedEmail
      provenance.email = { source, path: config.emailClaim }
      identity.emailVerified = isAffirmativeClaim(getClaimByPath(incoming, 'email_verified'))
    }
  }
  if (config.wantImage && !identity.image) {
    const claimedImage = asHttpUrl(getClaimByPath(incoming, config.imageClaim))
    if (claimedImage) {
      identity.image = claimedImage
      provenance.image = { source, path: config.imageClaim }
    }
  }

  return {
    ...state,
    identity,
    provenance,
    acceptedClaims,
    sourceAvailability: { ...state.sourceAvailability, [source]: 'available' },
  }
}

export function finishBinding(state: BindingState): BindingState {
  return state
}

function snapshotUnavailable(snapshot: SourceSnapshot): SourceUnavailableReason | undefined {
  if ('unavailable' in snapshot && snapshot.unavailable) return snapshot.unavailable
  return undefined
}

function snapshotClaims(snapshot: SourceSnapshot): Record<string, unknown> | null {
  if (snapshotUnavailable(snapshot)) return null
  return 'claims' in snapshot && snapshot.claims ? snapshot.claims : null
}

export function replayClaimMapping(
  config: BindingConfig,
  snapshots: SourceSnapshot[]
): BindingState {
  let state = createBindingState(config)
  const bySource = new Map<IdentitySource, SourceSnapshot>()
  for (const snapshot of snapshots) {
    if (!bySource.has(snapshot.source)) bySource.set(snapshot.source, snapshot)
  }
  for (const source of state.config.sources) {
    if (!state.config.exhaustive && bindingComplete(state)) break
    if (state.failed) break
    const snapshot = bySource.get(source)
    if (!snapshot) {
      state = advanceBindingState(state, source, null, 'absent')
      continue
    }
    const unavailable = snapshotUnavailable(snapshot)
    state = advanceBindingState(state, source, snapshotClaims(snapshot), unavailable)
  }
  return state
}
