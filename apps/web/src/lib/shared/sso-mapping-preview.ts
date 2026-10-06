/**
 * Draft mapping preview. Replays captured source snapshots through the same
 * binder production uses. No alternate value extraction.
 */

import {
  allowsMissingEmail,
  claimMappingFor,
  identityMappingFor,
  identitySourcesFor,
  profileClaimFor,
  profileSyncEnabled,
  type IdentityProviderClaimMapping,
  type IdentitySource,
  type ProfileField,
} from './oidc-claim-mapping'
import { planClaimAttributeWrites, type AttributeDefinition } from './plan-claim-attribute-writes'
import { resolveSsoRoleMatch } from './resolve-sso-role'
import type { Role } from './roles'
import { finishBinding, replayClaimMapping } from './sso-claim-binder'
import { finalizeProfileOutcome, type ProfileOutcome } from './sso-profile-outcome'
import { isReplayableCapture, type SsoTestCapture } from './sso-test-capture'

export const SOURCE_WORDS: Record<IdentitySource, string> = {
  idToken: 'ID token',
  userinfo: 'userinfo',
  accessTokenJwt: 'access token JWT',
}

export type MappingPreviewStatus = 'ready' | 'needs_retest' | 'mapping_failed'

export type MappingPreviewPolicy = {
  autoCreateUsers: boolean
  autoProvisionRole: Role | null
  detailsChangedAt?: string | null
  registrationId: string
}

export type MappingPreview = {
  status: MappingPreviewStatus
  identity: ProfileOutcome | null
  roleMatch: { role: Role; ruleIndex: number } | null
  peoplePlan: ReturnType<typeof planClaimAttributeWrites> | null
  stale: boolean
  limitations: string[]
  missingSource: IdentitySource | null
  capture: SsoTestCapture | null
}

export function selectMappingCapture(args: {
  registrationId: string
  sessionCapture?: SsoTestCapture | null
  persistedCapture?: SsoTestCapture | null
}): SsoTestCapture | null {
  const candidates = [args.sessionCapture, args.persistedCapture].filter(
    (c): c is SsoTestCapture => !!c && c.registrationId === args.registrationId
  )
  if (candidates.length === 0) return null
  return candidates.reduce((newest, current) =>
    new Date(current.capturedAt).getTime() > new Date(newest.capturedAt).getTime()
      ? current
      : newest
  )
}

function requiredClaimPathsFor(stored: unknown): string[] {
  const mapping = claimMappingFor(stored)
  return [
    ...(mapping.attributes?.map ?? []).map((entry) => entry.claimPath),
    ...(mapping.role?.claimPath ? [mapping.role.claimPath] : []),
  ]
}

/** True when current provider details are newer than the config the handshake used. */
export function captureConfigIsStale(
  detailsChangedAt: string | null | undefined,
  capture: SsoTestCapture
): boolean {
  if (!detailsChangedAt) return false
  const currentMs = new Date(detailsChangedAt).getTime()
  if (!Number.isFinite(currentMs)) return false
  if (isReplayableCapture(capture)) {
    if (capture.detailsChangedAtAtStart == null) return true
    const startMs = new Date(capture.detailsChangedAtAtStart).getTime()
    return Number.isFinite(startMs) && currentMs > startMs
  }
  const capturedMs = new Date(capture.capturedAt).getTime()
  return Number.isFinite(capturedMs) && currentMs > capturedMs
}

function sourceMissingFromCapture(draft: unknown, capture: SsoTestCapture): IdentitySource | null {
  if (!isReplayableCapture(capture)) return null
  const captured = new Set(capture.replay.sources.map((s) => s.source))
  for (const source of identitySourcesFor(draft)) {
    if (!captured.has(source)) return source
  }
  return null
}

export function previewClaimMapping({
  draft,
  capture,
  definitions,
  providerPolicy,
}: {
  draft: IdentityProviderClaimMapping | null
  capture: SsoTestCapture | null
  definitions: AttributeDefinition[]
  providerPolicy: MappingPreviewPolicy
}): MappingPreview {
  if (!capture || capture.registrationId !== providerPolicy.registrationId) {
    return {
      status: 'needs_retest',
      identity: null,
      roleMatch: null,
      peoplePlan: null,
      stale: false,
      limitations: [],
      missingSource: null,
      capture: null,
    }
  }

  const stale = captureConfigIsStale(providerPolicy.detailsChangedAt, capture)

  if (!isReplayableCapture(capture)) {
    return {
      status: 'needs_retest',
      identity: null,
      roleMatch: null,
      peoplePlan: null,
      stale,
      limitations: ['Run a new test sign-in to preview mappings accurately.'],
      missingSource: null,
      capture,
    }
  }

  const missingSource = sourceMissingFromCapture(draft, capture)
  if (missingSource) {
    return {
      status: 'needs_retest',
      identity: null,
      roleMatch: null,
      peoplePlan: null,
      stale,
      limitations: [
        `${SOURCE_WORDS[missingSource]} was not captured by this test. Run a new test before relying on this source configuration.`,
      ],
      missingSource,
      capture,
    }
  }

  const identityMapping = identityMappingFor(draft)
  const bound = finishBinding(
    replayClaimMapping(
      {
        mapping: identityMapping,
        requiredClaimPaths: requiredClaimPathsFor(draft),
        wantImage: true,
      },
      capture.replay.sources
    )
  )
  const identity = finalizeProfileOutcome(bound, {
    allowMissingEmail: allowsMissingEmail(draft),
    usernameClaim: identityMapping.usernameClaim,
  })
  const mapping = claimMappingFor(draft)
  const roleMatch = resolveSsoRoleMatch(identity.acceptedClaims, mapping.role)
  const peoplePlan = mapping.attributes
    ? planClaimAttributeWrites({
        claims: identity.acceptedClaims,
        mapping: mapping.attributes,
        existing: {},
        definitions,
        explain: true,
      })
    : null

  const limitations: string[] = [
    profileSyncEnabled(draft)
      ? 'Name, email and avatar show what a new account gets. Later sign-ins update the name and avatar unless someone changed them in Quackback. Email is not changed.'
      : 'Name, email and avatar show what a new account gets. Existing profiles are not changed on later sign-ins.',
    'People preview assumes no existing attributes.',
  ]
  if (stale) {
    limitations.unshift(
      'Configuration changed since this test. Re-test to validate it. Preview uses the captured claims with your current draft.'
    )
  }

  return {
    status: capture.outcome === 'mapping_failed' ? 'mapping_failed' : 'ready',
    identity,
    roleMatch,
    peoplePlan,
    stale,
    limitations,
    missingSource: null,
    capture,
  }
}

/** What each profile field reads from one test sign-in. An absent key means
 *  the field gets nothing from it. */
export type ProfileFieldValues = Partial<Record<ProfileField, string>>

/**
 * The value each profile field takes from a test sign-in under a draft
 * mapping, for the Profile card's "Last test sign-in" column. A projection of the
 * profile outcome sign-in computes, so a mapped avatar claim never falls back
 * to `picture`, only an http(s) URL counts, and the username follows
 * `usernameFrom`.
 *
 * Every source is replayed: sign-in reads the username only when the provider
 * sends no name, and the column shows what the test sent even when it did. The
 * name is left out when the provider sent none, since sign-up would generate
 * it rather than read it.
 *
 * Null whenever the outcome preview asks for a new test (no replayable
 * capture, or a configured source the capture lacks), so the two never show
 * different answers.
 */
export function previewProfileValues(
  draft: unknown,
  capture: SsoTestCapture | null | undefined
): ProfileFieldValues | null {
  if (!capture || !isReplayableCapture(capture)) return null
  if (sourceMissingFromCapture(draft, capture)) return null
  const mapping = identityMappingFor(draft)
  const outcome = finalizeProfileOutcome(
    finishBinding(
      replayClaimMapping(
        {
          mapping,
          requiredClaimPaths: mapping.usernameClaim ? [mapping.usernameClaim] : undefined,
          wantImage: true,
          exhaustive: true,
        },
        capture.replay.sources
      )
    ),
    { allowMissingEmail: allowsMissingEmail(draft), usernameClaim: mapping.usernameClaim }
  )
  const values: ProfileFieldValues = {}
  if (outcome.id) values.id = outcome.id
  if (outcome.email) values.email = outcome.email
  if (outcome.name && !outcome.nameSynthesized) values.name = outcome.name
  if (outcome.username) values.username = outcome.username
  if (outcome.image) values.image = outcome.image
  return values
}

export function effectiveIdPath(draft: unknown): string {
  return profileClaimFor(draft, 'id') ?? 'sub'
}

export function effectiveEmailPath(draft: unknown): string {
  return profileClaimFor(draft, 'email') ?? 'email'
}

export function effectiveNamePath(draft: unknown): string {
  return profileClaimFor(draft, 'name') ?? 'name'
}

export function runtimeFallbackRole(autoProvisionRole: Role | null): {
  role: Role
  label: string
} {
  if (autoProvisionRole == null) return { role: 'member', label: 'Member (runtime default)' }
  const labels: Record<Role, string> = {
    admin: 'Admin',
    member: 'Member',
    user: 'User',
  }
  return { role: autoProvisionRole, label: labels[autoProvisionRole] }
}
