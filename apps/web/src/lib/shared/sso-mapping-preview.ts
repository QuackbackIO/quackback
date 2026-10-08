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
  readRoleRule,
  getClaimByPath,
  type IdentityProviderClaimMapping,
  type IdentitySource,
  type ProfileField,
} from './oidc-claim-mapping'
import { planClaimAttributeWrites, type AttributeDefinition } from './plan-claim-attribute-writes'
import { resolveSsoRoleMatch, roleRuleMatchesClaim } from './resolve-sso-role'
import { claimValuesAt } from './claim-suggestions'
import { isPlainRecord as isRecord } from './record'
import type { Role } from './roles'
import { finishBinding, replayClaimMapping } from './sso-claim-binder'
import { finalizeProfileOutcome, type ProfileOutcome } from './sso-profile-outcome'
import { isReplayableCapture, type SsoTestCapture, type SsoTestCaptureV2 } from './sso-test-capture'

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

/**
 * The rule a test person matched. `roleId` is the workspace role it grants on
 * top of the tier, `roleName` its name when the caller passed the role list,
 * and `roleMissing` marks a role that list no longer has: sign-in then grants
 * nothing and leaves the person's role as it is.
 */
export type RolePreviewMatch = {
  role: Role
  ruleIndex: number
  roleId?: string
  roleName?: string
  roleMissing?: true
}

/** A workspace role as the preview names it. */
export type PreviewRole = { id: string; name: string }

export type MappingPreview = {
  status: MappingPreviewStatus
  identity: ProfileOutcome | null
  roleMatch: RolePreviewMatch | null
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

/** The profile outcome sign-in would compute from a capture under a draft. */
function replayIdentity(draft: unknown, capture: SsoTestCaptureV2): ProfileOutcome {
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
  return finalizeProfileOutcome(bound, {
    allowMissingEmail: allowsMissingEmail(draft),
    usernameClaim: identityMapping.usernameClaim,
  })
}

function sourceMissingFromCapture(draft: unknown, capture: SsoTestCapture): IdentitySource | null {
  if (!isReplayableCapture(capture)) return null
  const captured = new Set(capture.replay.sources.map((s) => s.source))
  for (const source of identitySourcesFor(draft)) {
    if (!captured.has(source)) return source
  }
  return null
}

function namedRoleMatch(
  match: ReturnType<typeof resolveSsoRoleMatch>,
  roles: ReadonlyArray<PreviewRole> | undefined
): RolePreviewMatch | null {
  if (!match) return null
  const result: RolePreviewMatch = { ...match }
  if (match.roleId && roles) {
    const found = roles.find((r) => r.id === match.roleId)
    if (found) result.roleName = found.name
    else result.roleMissing = true
  }
  return result
}

export function previewClaimMapping({
  draft,
  capture,
  definitions,
  providerPolicy,
  roles,
}: {
  draft: IdentityProviderClaimMapping | null
  capture: SsoTestCapture | null
  definitions: AttributeDefinition[]
  providerPolicy: MappingPreviewPolicy
  /** Workspace roles, to name a matched rule's role. */
  roles?: ReadonlyArray<PreviewRole>
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

  const identity = replayIdentity(draft, capture)
  const mapping = claimMappingFor(draft)
  const roleMatch = namedRoleMatch(
    resolveSsoRoleMatch(identity.acceptedClaims, isRecord(draft) ? draft.role : undefined),
    roles
  )
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

/** How a draft's role rules fare against one test sign-in. */
export type RoleRuleMatches = {
  /** The role claim path the rules read. */
  claimPath: string
  /** Per draft rule, in draft order: whether the test person's claim holds its value. */
  ruleMatches: boolean[]
  /** The rule sign-in would apply (first match wins), or null when none matches. */
  firstMatchIndex: number | null
  /** The distinct values the test person's claim held at the path. */
  valuesAtPath: string[]
}

/**
 * Every role rule checked against a test sign-in, not only the winner, so the
 * editor can mark each row. Indexes follow the draft's own rule list. A rule
 * sign-in would not read (for example a malformed role id) never counts as the
 * first match, though its row still reports whether the value is present.
 *
 * Null when there is no role section with a claim path, or whenever the
 * outcome preview asks for a new test, so the two never disagree.
 */
export function previewRoleRuleMatches(
  draft: unknown,
  capture: SsoTestCapture | null | undefined
): RoleRuleMatches | null {
  if (!capture || !isReplayableCapture(capture)) return null
  if (sourceMissingFromCapture(draft, capture)) return null
  const roleSection = isRecord(draft) && isRecord(draft.role) ? draft.role : null
  const claimPath = claimMappingFor(draft).role?.claimPath
  if (!roleSection || !claimPath) return null
  const rules = Array.isArray(roleSection.rules) ? roleSection.rules : []
  const claims = replayIdentity(draft, capture).acceptedClaims
  const claim = getClaimByPath(claims, claimPath)
  const ruleMatches = rules.map(
    (rule) =>
      isRecord(rule) &&
      typeof rule.whenContains === 'string' &&
      roleRuleMatchesClaim(claim, rule.whenContains)
  )
  const first = ruleMatches.findIndex((hit, i) => hit && readRoleRule(rules[i]) !== undefined)
  return {
    claimPath,
    ruleMatches,
    firstMatchIndex: first < 0 ? null : first,
    valuesAtPath: claimValuesAt(claims, claimPath),
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

/**
 * The role a provider gives a new account at a verified domain when no rule
 * matches and no default role was saved. Sign-in, the settings form and the
 * preview all read it, so what an admin sees is what sign-in does.
 */
export const DEFAULT_PROVISION_ROLE: Role = 'member'
