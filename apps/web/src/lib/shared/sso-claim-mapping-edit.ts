/**
 * Closed operations over stored claim_mapping JSON. Unedited raw keys survive.
 */

import {
  DEFAULT_IDENTITY_SOURCES,
  IDENTITY_SOURCES,
  PROFILE_FIELDS,
  allowsMissingEmail,
  identitySourcesFor,
  isProfileField,
  isRoleRuleRoleId,
  profileClaimFor,
  profileSyncEnabled,
  type IdentityProviderClaimMapping,
  type IdentitySource,
  type ProfileField,
} from './oidc-claim-mapping'
import type { Role } from './roles'
import { isPlainRecord as isRecord } from './record'
import { PERMISSIONS, WORKSPACE_ADMIN_PERMISSIONS, type PermissionKey } from './permissions'

export const MAX_CLAIM_PATH_LENGTH = 256

/** A role rule as the editor writes it. `roleId` grants a workspace role on
 *  top of the member tier and is only valid with `role: 'member'`. */
export type RoleRule = { whenContains: string; role: Role; roleId?: string }
export type PeopleEntry = { claimPath: string; attributeKey: string }

export type ClaimMappingOperation =
  | { op: 'setProfileClaim'; field: ProfileField; path: string }
  | { op: 'resetProfileClaim'; field: ProfileField }
  | { op: 'setSources'; sources: IdentitySource[] }
  | { op: 'resetSources' }
  | { op: 'setAllowMissingEmail'; allow: boolean }
  | { op: 'setProfileSync'; syncOnSignIn: boolean }
  | { op: 'setRolePath'; claimPath: string }
  | { op: 'insertRoleRule'; index: number; rule: RoleRule }
  | { op: 'editRoleRule'; index: number; rule: RoleRule }
  | { op: 'removeRoleRule'; index: number }
  | { op: 'reorderRoleRule'; from: number; to: number }
  | { op: 'setRoleSync'; syncOnEverySignIn: boolean }
  | { op: 'removeRole' }
  | { op: 'insertPeopleMapping'; index: number; entry: PeopleEntry }
  | { op: 'editPeopleMapping'; index: number; entry: PeopleEntry }
  | { op: 'removePeopleMapping'; index: number }
  | { op: 'setPeopleFlags'; overrideExisting?: boolean; syncOnSignIn?: boolean }

export class ClaimMappingEditError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ClaimMappingEditError'
  }
}

function cloneRaw(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {}
  return structuredClone(raw)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function trimPath(path: string, label: string): string {
  const trimmed = path.trim()
  if (!trimmed) {
    throw new ClaimMappingEditError('INVALID_CLAIM_PATH', `${label} is required.`)
  }
  if (trimmed.length > MAX_CLAIM_PATH_LENGTH) {
    throw new ClaimMappingEditError(
      'INVALID_CLAIM_PATH',
      `${label} must be at most ${MAX_CLAIM_PATH_LENGTH} characters.`
    )
  }
  return trimmed
}

function requireRole(role: string): Role {
  if (role !== 'admin' && role !== 'member' && role !== 'user') {
    throw new ClaimMappingEditError('INVALID_ROLE', 'Role must be admin, member, or user.')
  }
  return role
}

/** The stored shape of one rule, validated. Absent `roleId` means the plain tier. */
function storedRoleRule(rule: RoleRule): Record<string, unknown> {
  const whenContains = rule.whenContains.trim()
  if (!whenContains) {
    throw new ClaimMappingEditError('INVALID_ROLE_RULE', 'A role rule has no value.')
  }
  const role = requireRole(rule.role)
  if (rule.roleId == null) return { whenContains, role }
  if (role !== 'member') {
    throw new ClaimMappingEditError(
      'INVALID_ROLE_RULE',
      'A workspace role can only be granted on the member tier.'
    )
  }
  if (!isRoleRuleRoleId(rule.roleId)) {
    throw new ClaimMappingEditError('INVALID_ROLE_RULE', 'That role does not exist.')
  }
  return { whenContains, role, roleId: rule.roleId }
}

function profileObject(next: Record<string, unknown>): Record<string, unknown> {
  const profile = asRecord(next.profile)
  next.profile = profile
  return profile
}

function roleObject(next: Record<string, unknown>): Record<string, unknown> {
  const role = asRecord(next.role)
  next.role = role
  return role
}

function attributesObject(next: Record<string, unknown>): Record<string, unknown> {
  const attributes = asRecord(next.attributes)
  next.attributes = attributes
  return attributes
}

function roleRules(role: Record<string, unknown>): unknown[] {
  return Array.isArray(role.rules) ? role.rules : []
}

function peopleMap(attributes: Record<string, unknown>): unknown[] {
  return Array.isArray(attributes.map) ? attributes.map : []
}

function pruneEmpty(next: Record<string, unknown>): unknown {
  if (isRecord(next.profile) && Object.keys(next.profile).length === 0) delete next.profile
  if (isRecord(next.role) && Object.keys(next.role).length === 0) delete next.role
  if (isRecord(next.attributes)) {
    if (Array.isArray(next.attributes.map) && next.attributes.map.length === 0) {
      delete next.attributes.map
    }
    if (Object.keys(next.attributes).length === 0) delete next.attributes
  }
  return Object.keys(next).length > 0 ? next : null
}

export function applyClaimMappingEdits(
  raw: unknown,
  operations: readonly ClaimMappingOperation[]
): unknown {
  const next = cloneRaw(raw)
  const roleRemoves = operations
    .filter(
      (op): op is Extract<ClaimMappingOperation, { op: 'removeRoleRule' }> =>
        op.op === 'removeRoleRule'
    )
    .map((op) => op.index)
    .sort((a, b) => b - a)
  const peopleRemoves = operations
    .filter(
      (op): op is Extract<ClaimMappingOperation, { op: 'removePeopleMapping' }> =>
        op.op === 'removePeopleMapping'
    )
    .map((op) => op.index)
    .sort((a, b) => b - a)

  const rest = operations.filter(
    (op) => op.op !== 'removeRoleRule' && op.op !== 'removePeopleMapping'
  )

  for (const index of roleRemoves) {
    const role = roleObject(next)
    const rules = roleRules(role)
    if (index < 0 || index >= rules.length) {
      throw new ClaimMappingEditError('INVALID_OPERATION', 'Role rule index is out of range.')
    }
    rules.splice(index, 1)
    role.rules = rules
  }
  for (const index of peopleRemoves) {
    const attributes = attributesObject(next)
    const map = peopleMap(attributes)
    if (index < 0 || index >= map.length) {
      throw new ClaimMappingEditError('INVALID_OPERATION', 'People mapping index is out of range.')
    }
    map.splice(index, 1)
    attributes.map = map
  }

  for (const operation of rest) {
    applyOne(next, operation)
  }
  return pruneEmpty(next)
}

function applyOne(next: Record<string, unknown>, operation: ClaimMappingOperation): void {
  switch (operation.op) {
    case 'setProfileClaim': {
      const profile = profileObject(next)
      const claims = asRecord(profile.claims)
      claims[operation.field] = trimPath(operation.path, 'Claim path')
      profile.claims = claims
      return
    }
    case 'resetProfileClaim': {
      if (!isRecord(next.profile) || !isRecord(next.profile.claims)) return
      delete next.profile.claims[operation.field]
      if (Object.keys(next.profile.claims).length === 0) delete next.profile.claims
      return
    }
    case 'setSources': {
      if (operation.sources.length === 0) {
        throw new ClaimMappingEditError(
          'INVALID_SOURCES',
          'At least one identity source is required.'
        )
      }
      const sources = operation.sources.filter((source) =>
        (IDENTITY_SOURCES as readonly string[]).includes(source)
      )
      if (sources.length === 0) {
        throw new ClaimMappingEditError(
          'INVALID_SOURCES',
          'At least one identity source is required.'
        )
      }
      profileObject(next).sources = sources
      return
    }
    case 'resetSources': {
      if (isRecord(next.profile)) delete next.profile.sources
      return
    }
    case 'setAllowMissingEmail': {
      const profile = profileObject(next)
      if (operation.allow) profile.allowMissingEmail = true
      else delete profile.allowMissingEmail
      return
    }
    case 'setProfileSync': {
      const profile = profileObject(next)
      if (operation.syncOnSignIn) profile.syncOnSignIn = true
      else delete profile.syncOnSignIn
      return
    }
    case 'setRolePath': {
      roleObject(next).claimPath = trimPath(operation.claimPath, 'Role claim path')
      if (!Array.isArray(roleObject(next).rules)) roleObject(next).rules = []
      return
    }
    case 'insertRoleRule': {
      const stored = storedRoleRule(operation.rule)
      const role = roleObject(next)
      const rules = roleRules(role)
      const index = Math.max(0, Math.min(operation.index, rules.length))
      rules.splice(index, 0, stored)
      role.rules = rules
      if (typeof role.claimPath !== 'string' || !role.claimPath.trim()) {
        role.claimPath = 'groups'
      }
      return
    }
    case 'editRoleRule': {
      const role = roleObject(next)
      const rules = roleRules(role)
      if (operation.index < 0 || operation.index >= rules.length) {
        throw new ClaimMappingEditError('INVALID_OPERATION', 'Role rule index is out of range.')
      }
      // Unknown keys on the stored rule survive; the custom role is a known
      // key, so an edit without one clears it rather than keeping a stale grant.
      const existing = { ...asRecord(rules[operation.index]) }
      delete existing.roleId
      rules[operation.index] = { ...existing, ...storedRoleRule(operation.rule) }
      role.rules = rules
      return
    }
    case 'reorderRoleRule': {
      const role = roleObject(next)
      const rules = roleRules(role)
      if (operation.from < 0 || operation.from >= rules.length) {
        throw new ClaimMappingEditError('INVALID_OPERATION', 'Role rule index is out of range.')
      }
      const [moved] = rules.splice(operation.from, 1)
      const to = Math.max(0, Math.min(operation.to, rules.length))
      rules.splice(to, 0, moved)
      role.rules = rules
      return
    }
    case 'setRoleSync': {
      const role = roleObject(next)
      if (operation.syncOnEverySignIn) role.syncOnEverySignIn = true
      else delete role.syncOnEverySignIn
      if (typeof role.claimPath !== 'string') role.claimPath = 'groups'
      if (!Array.isArray(role.rules)) role.rules = []
      return
    }
    case 'removeRole': {
      delete next.role
      return
    }
    case 'insertPeopleMapping': {
      const attributes = attributesObject(next)
      const map = peopleMap(attributes)
      const index = Math.max(0, Math.min(operation.index, map.length))
      map.splice(index, 0, {
        claimPath: trimPath(operation.entry.claimPath, 'Claim path'),
        attributeKey: trimPath(operation.entry.attributeKey, 'People attribute'),
      })
      attributes.map = map
      return
    }
    case 'editPeopleMapping': {
      const attributes = attributesObject(next)
      const map = peopleMap(attributes)
      if (operation.index < 0 || operation.index >= map.length) {
        throw new ClaimMappingEditError(
          'INVALID_OPERATION',
          'People mapping index is out of range.'
        )
      }
      const existing = asRecord(map[operation.index])
      map[operation.index] = {
        ...existing,
        claimPath: trimPath(operation.entry.claimPath, 'Claim path'),
        attributeKey: trimPath(operation.entry.attributeKey, 'People attribute'),
      }
      attributes.map = map
      return
    }
    case 'setPeopleFlags': {
      const attributes = attributesObject(next)
      if (operation.overrideExisting === true) attributes.overrideExisting = true
      if (operation.overrideExisting === false) delete attributes.overrideExisting
      if (operation.syncOnSignIn === true) attributes.syncOnSignIn = true
      if (operation.syncOnSignIn === false) delete attributes.syncOnSignIn
      return
    }
    case 'removeRoleRule':
    case 'removePeopleMapping':
      return
  }
}

export function explicitIdClaim(raw: unknown): string | undefined {
  return profileClaimFor(raw, 'id')
}

export function effectiveProfileSignature(raw: unknown): string {
  const id = explicitIdClaim(raw)
  const profile = isRecord(raw) && isRecord(raw.profile) ? raw.profile : {}
  // Username, avatar and sync are known keys outside the signature: none of
  // them changes which account a sign-in matches, so editing one must not
  // invalidate a passing connection test.
  const unknownProfileKeys = Object.keys(profile)
    .filter((key) => !SUPPORTED_PROFILE.has(key))
    .sort()
  const claims = isRecord(profile.claims) ? profile.claims : {}
  const unknownClaimKeys = Object.keys(claims)
    .filter((key) => !isProfileField(key))
    .sort()
  return JSON.stringify({
    sources: identitySourcesFor(raw),
    id: id === undefined ? { mode: 'default' } : { mode: 'explicit', path: id },
    email: profileClaimFor(raw, 'email') ?? 'email',
    name: profileClaimFor(raw, 'name') ?? 'name',
    allowMissingEmail: allowsMissingEmail(raw),
    unknownProfileKeys,
    unknownClaimKeys,
  })
}

/**
 * Whether a permission bundle reaches the admin tier: it holds any permission
 * the Admin preset has and the Manager preset lacks. Workspace roles all ride
 * the member column, so the bundle is the only place the tier shows.
 */
export function isAdminTierBundle(permissionKeys: readonly string[]): boolean {
  return permissionKeys.some((key) => WORKSPACE_ADMIN_PERMISSIONS.includes(key as PermissionKey))
}

/**
 * Whether a permission bundle can manage SSO, and so fix this provider's
 * settings. Narrower than the admin tier: the save confirmation asks about
 * any admin-level grant, while lockout decisions ask who could undo a mistake.
 */
export function canManageSso(permissionKeys: readonly string[]): boolean {
  return permissionKeys.includes(PERMISSIONS.AUTH_MANAGE)
}

/** The ids of the roles whose bundle reaches the admin tier. */
export function adminTierRoleIds(
  roles: ReadonlyArray<{ id: string; permissionKeys: readonly string[] }>
): Set<string> {
  return new Set(roles.filter((r) => isAdminTierBundle(r.permissionKeys)).map((r) => r.id))
}

/** A rule that hands out admin-level access: the admin tier, or a workspace
 *  role whose bundle reaches it. */
export type AdminRoleRule = { index: number; role: Role; roleId?: string }

export function mappingSaveRisks(
  before: unknown,
  after: unknown,
  opts: { adminTierRoleIds?: ReadonlySet<string> } = {}
): {
  identifierChanged: boolean
  hasAdminRules: boolean
  adminRules: AdminRoleRule[]
} {
  const beforeId = explicitIdClaim(before)
  const afterId = explicitIdClaim(after)
  const sourcesChanged =
    JSON.stringify(identitySourcesFor(before)) !== JSON.stringify(identitySourcesFor(after))
  const identifierChanged = beforeId !== afterId || sourcesChanged
  const role = isRecord(after) && isRecord(after.role) ? after.role : null
  const rules = role && Array.isArray(role.rules) ? role.rules : []
  const adminRules: AdminRoleRule[] = []
  rules.forEach((rule, index) => {
    if (!isRecord(rule)) return
    if (rule.role === 'admin') adminRules.push({ index, role: 'admin' })
    else if (
      rule.role === 'member' &&
      typeof rule.roleId === 'string' &&
      opts.adminTierRoleIds?.has(rule.roleId)
    ) {
      adminRules.push({ index, role: 'member', roleId: rule.roleId })
    }
  })
  return {
    identifierChanged,
    hasAdminRules: adminRules.length > 0,
    adminRules,
  }
}

function storedRoleRules(mapping: unknown): unknown[] {
  const role = isRecord(mapping) && isRecord(mapping.role) ? mapping.role : null
  return role && Array.isArray(role.rules) ? role.rules : []
}

/**
 * The distinct workspace role ids a stored mapping's rules grant. With
 * `newSince`, only those of rules that mapping lacked (added, or changed in
 * value, tier or role): the grants a save from `newSince` would make.
 */
/**
 * The workspace roles a save must be able to grant. Any change to the role
 * section (claim path, rule order, rules added, removed or edited, the sync
 * flag) can change who gets which role, so it re-grants every role its rules
 * give; an untouched role section grants nothing new.
 */
export function roleRuleGrantsToCheck(before: unknown, after: unknown): string[] {
  const section = (m: unknown) => (isRecord(m) ? m.role : undefined)
  if (storedJsonEqual(section(before), section(after))) return []
  return roleRuleRoleIds(after)
}

export function roleRuleRoleIds(mapping: unknown, opts: { newSince?: unknown } = {}): string[] {
  const kept =
    opts.newSince === undefined
      ? null
      : new Set(storedRoleRules(opts.newSince).map(roleRuleIdentity))
  const ids = new Set<string>()
  for (const rule of storedRoleRules(mapping)) {
    if (!isRecord(rule) || !isRoleRuleRoleId(rule.roleId)) continue
    if (kept?.has(roleRuleIdentity(rule))) continue
    ids.add(rule.roleId)
  }
  return [...ids]
}

/**
 * Checks the grants a role-mapping save makes, from the stored mapping to the
 * proposed one, and reports which roles its rules name reach the admin tier.
 * Built for the saving admin by the roles domain; throws to refuse the save.
 */
export type RoleRuleGrantCheck = (
  before: unknown,
  after: unknown
) => Promise<{ adminTierRoleIds: ReadonlySet<string> }>

export function sourcesAreDefault(sources: IdentitySource[] | undefined): boolean {
  if (!sources || sources.length === 0) return true
  return JSON.stringify(sources) === JSON.stringify(DEFAULT_IDENTITY_SOURCES)
}

/** A rule's identity: what it matches and what it grants, custom role included. */
export function roleRuleIdentity(rule: unknown): string | null {
  if (!isRecord(rule)) return null
  if (typeof rule.whenContains !== 'string' || typeof rule.role !== 'string') return null
  const roleId = typeof rule.roleId === 'string' ? rule.roleId : ''
  return `${rule.whenContains}\0${rule.role}\0${roleId}`
}

/** After identities are a submultiset of before: remove extras, then permute survivors. */
function subsetPermuteOps(
  beforeRows: unknown[],
  afterRows: unknown[],
  identity: (row: unknown) => string | null,
  removeOp: (index: number) => ClaimMappingOperation,
  reorderOp?: (from: number, to: number) => ClaimMappingOperation
): ClaimMappingOperation[] | null {
  if (afterRows.length > beforeRows.length) return null
  const beforeKeys = beforeRows.map(identity)
  const afterKeys = afterRows.map(identity)
  if (beforeKeys.some((key) => key == null) || afterKeys.some((key) => key == null)) return null
  const need = new Map<string, number>()
  for (const key of afterKeys) need.set(key!, (need.get(key!) ?? 0) + 1)
  const have = new Map<string, number>()
  for (const key of beforeKeys) have.set(key!, (have.get(key!) ?? 0) + 1)
  for (const [key, count] of need) {
    if ((have.get(key) ?? 0) < count) return null
  }
  const ops: ClaimMappingOperation[] = []
  const working = [...beforeKeys] as string[]
  for (let i = working.length - 1; i >= 0; i--) {
    const key = working[i]
    if ((have.get(key) ?? 0) > (need.get(key) ?? 0)) {
      ops.push(removeOp(i))
      working.splice(i, 1)
      have.set(key, (have.get(key) ?? 1) - 1)
    }
  }
  if (working.length !== afterKeys.length) return null
  if (!reorderOp) {
    return working.every((key, i) => key === afterKeys[i]) ? ops : null
  }
  for (let i = 0; i < afterKeys.length; i++) {
    const want = afterKeys[i]!
    if (working[i] === want) continue
    const from = working.indexOf(want, i)
    if (from < 0) return null
    working.splice(from, 1)
    working.splice(i, 0, want)
    ops.push(reorderOp(from, i))
  }
  return ops
}

/** Diff supported editor state against stored JSON into closed operations. */
export function diffClaimMappingOperations(
  before: unknown,
  proposed: IdentityProviderClaimMapping | null
): ClaimMappingOperation[] {
  const ops: ClaimMappingOperation[] = []
  const beforeAllow = allowsMissingEmail(before)
  const afterAllow = proposed?.profile?.allowMissingEmail === true
  if (beforeAllow !== afterAllow) ops.push({ op: 'setAllowMissingEmail', allow: afterAllow })

  const afterSources = proposed?.profile?.sources
  const afterEffectiveSources = afterSources?.length ? afterSources : identitySourcesFor(proposed)
  if (JSON.stringify(identitySourcesFor(before)) !== JSON.stringify(afterEffectiveSources)) {
    if (sourcesAreDefault(afterEffectiveSources)) ops.push({ op: 'resetSources' })
    else ops.push({ op: 'setSources', sources: afterEffectiveSources })
  }

  const beforeProfileSync = profileSyncEnabled(before)
  const afterProfileSync = profileSyncEnabled(proposed)
  if (beforeProfileSync !== afterProfileSync) {
    ops.push({ op: 'setProfileSync', syncOnSignIn: afterProfileSync })
  }

  for (const field of PROFILE_FIELDS) {
    const beforePath = profileClaimFor(before, field)
    const afterPath = proposed?.profile?.claims?.[field]?.trim() || undefined
    if (beforePath === afterPath) continue
    if (!afterPath) ops.push({ op: 'resetProfileClaim', field })
    else ops.push({ op: 'setProfileClaim', field, path: afterPath })
  }

  const beforeRole = isRecord(before) && isRecord(before.role) ? before.role : null
  const afterRole = proposed?.role ?? null
  if (!afterRole) {
    if (beforeRole) ops.push({ op: 'removeRole' })
  } else {
    const beforePath = typeof beforeRole?.claimPath === 'string' ? beforeRole.claimPath : undefined
    if (beforePath !== afterRole.claimPath)
      ops.push({ op: 'setRolePath', claimPath: afterRole.claimPath })
    const beforeSync = beforeRole?.syncOnEverySignIn === true
    const afterSync = afterRole.syncOnEverySignIn === true
    if (beforeSync !== afterSync) ops.push({ op: 'setRoleSync', syncOnEverySignIn: afterSync })
    const beforeRules = Array.isArray(beforeRole?.rules) ? beforeRole.rules : []
    const afterRules = afterRole.rules ?? []
    const aligned = subsetPermuteOps(
      beforeRules,
      afterRules,
      roleRuleIdentity,
      (index) => ({ op: 'removeRoleRule', index }),
      (from, to) => ({ op: 'reorderRoleRule', from, to })
    )
    if (aligned) {
      ops.push(...aligned)
    } else {
      const commonRules = Math.min(beforeRules.length, afterRules.length)
      for (let i = 0; i < commonRules; i++) {
        const left = beforeRules[i]
        const right = afterRules[i]
        if (roleRuleIdentity(left) !== roleRuleIdentity(right)) {
          ops.push({ op: 'editRoleRule', index: i, rule: right })
        }
      }
      for (let i = beforeRules.length - 1; i >= commonRules; i--) {
        ops.push({ op: 'removeRoleRule', index: i })
      }
      for (let i = commonRules; i < afterRules.length; i++) {
        ops.push({ op: 'insertRoleRule', index: i, rule: afterRules[i] })
      }
    }
  }

  const beforeAttrs = isRecord(before) && isRecord(before.attributes) ? before.attributes : null
  const afterAttrs = proposed?.attributes ?? null
  const beforeMap = Array.isArray(beforeAttrs?.map) ? beforeAttrs.map : []
  const afterMap = afterAttrs?.map ?? []
  const peopleIdentity = (row: unknown) => {
    if (!isRecord(row)) return null
    if (typeof row.claimPath !== 'string' || typeof row.attributeKey !== 'string') return null
    return `${row.claimPath}\0${row.attributeKey}`
  }
  const peopleAligned = subsetPermuteOps(beforeMap, afterMap, peopleIdentity, (index) => ({
    op: 'removePeopleMapping',
    index,
  }))
  if (peopleAligned) {
    ops.push(...peopleAligned)
  } else {
    const commonMap = Math.min(beforeMap.length, afterMap.length)
    for (let i = 0; i < commonMap; i++) {
      const left = beforeMap[i]
      const right = afterMap[i]
      if (
        !isRecord(left) ||
        left.claimPath !== right.claimPath ||
        left.attributeKey !== right.attributeKey
      ) {
        ops.push({ op: 'editPeopleMapping', index: i, entry: right })
      }
    }
    for (let i = beforeMap.length - 1; i >= commonMap; i--) {
      ops.push({ op: 'removePeopleMapping', index: i })
    }
    for (let i = commonMap; i < afterMap.length; i++) {
      ops.push({ op: 'insertPeopleMapping', index: i, entry: afterMap[i] })
    }
  }
  const beforeOverride = beforeAttrs?.overrideExisting === true
  const afterOverride = afterAttrs?.overrideExisting === true
  const beforeSync = beforeAttrs?.syncOnSignIn === true
  const afterSync = afterAttrs?.syncOnSignIn === true
  if (beforeOverride !== afterOverride || beforeSync !== afterSync) {
    ops.push({
      op: 'setPeopleFlags',
      overrideExisting: afterOverride,
      syncOnSignIn: afterSync,
    })
  }

  return ops
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function storedJsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null)
}

const SUPPORTED_TOP = new Set(['profile', 'role', 'attributes'])
const SUPPORTED_PROFILE = new Set(['sources', 'claims', 'allowMissingEmail', 'syncOnSignIn'])
const SUPPORTED_CLAIMS: SupportedKeys = { has: isProfileField }
const SUPPORTED_ROLE = new Set(['claimPath', 'rules', 'syncOnEverySignIn'])
const SUPPORTED_ROLE_RULE = new Set(['whenContains', 'role', 'roleId'])
const SUPPORTED_ATTRIBUTES = new Set(['map', 'overrideExisting', 'syncOnSignIn'])
const SUPPORTED_PEOPLE_ROW = new Set(['claimPath', 'attributeKey'])

type SupportedKeys = { has(key: string): boolean }

function hasLostKeys(stored: unknown, submitted: unknown, supported: SupportedKeys): boolean {
  if (!isRecord(stored)) return false
  const dest = isRecord(submitted) ? submitted : {}
  for (const key of Object.keys(stored)) {
    if (supported.has(key)) continue
    if (!(key in dest) || !storedJsonEqual(stored[key], dest[key])) return true
  }
  return false
}

function hasLostRowExtras(
  storedRows: unknown,
  submittedRows: unknown,
  supported: Set<string>
): boolean {
  if (!Array.isArray(storedRows)) return false
  const dest = Array.isArray(submittedRows) ? submittedRows : []
  const n = Math.min(storedRows.length, dest.length)
  for (let i = 0; i < n; i++) {
    if (hasLostKeys(storedRows[i], dest[i], supported)) return true
  }
  return false
}

/** True when a whole-column submit would drop unknown stored JSON. */
export function mappingWouldStripUnsupported(stored: unknown, submitted: unknown): boolean {
  if (!isRecord(stored)) return false
  if (submitted == null) return Object.keys(stored).length > 0
  if (!isRecord(submitted)) return true
  if (hasLostKeys(stored, submitted, SUPPORTED_TOP)) return true
  if (hasLostKeys(stored.profile, submitted.profile, SUPPORTED_PROFILE)) return true
  const storedProfile = isRecord(stored.profile) ? stored.profile : undefined
  const submittedProfile = isRecord(submitted.profile) ? submitted.profile : undefined
  if (hasLostKeys(storedProfile?.claims, submittedProfile?.claims, SUPPORTED_CLAIMS)) return true
  if (hasLostKeys(stored.role, submitted.role, SUPPORTED_ROLE)) return true
  const storedRole = isRecord(stored.role) ? stored.role : undefined
  const submittedRole = isRecord(submitted.role) ? submitted.role : undefined
  if (hasLostRowExtras(storedRole?.rules, submittedRole?.rules, SUPPORTED_ROLE_RULE)) return true
  if (hasLostKeys(stored.attributes, submitted.attributes, SUPPORTED_ATTRIBUTES)) return true
  const storedAttrs = isRecord(stored.attributes) ? stored.attributes : undefined
  const submittedAttrs = isRecord(submitted.attributes) ? submitted.attributes : undefined
  if (hasLostRowExtras(storedAttrs?.map, submittedAttrs?.map, SUPPORTED_PEOPLE_ROW)) return true
  return false
}
