/**
 * How sign-in picks a role, in the order it really runs: role rules first
 * (first match wins, regardless of email domain), then the provider's default
 * role for an email at one of its verified domains, then nothing (the person
 * stays a portal user). The Roles card, the preview rail and the lockout
 * guard all read the same answer from here.
 */
import type { ClaimRoleRule } from '@/lib/shared/oidc-claim-mapping'
import { SYSTEM_ROLES } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'

/** One rule as the editor holds it. A custom role rides the member tier and
 *  names its role by id. */
export type RoleRuleDraft = ClaimRoleRule

export const ROLE_PRESET_LABELS: Record<Role, string> = {
  admin: 'Admin',
  member: 'Member',
  user: 'Portal user',
}

/** What sign-in uses when no default role was ever saved. */
export function effectiveDefaultRole(autoProvisionRole: Role | null | undefined): Role {
  return autoProvisionRole ?? 'member'
}

export function verifiedDomainNames(
  domains: ReadonlyArray<{ name: string; verifiedAt: string | null }>
): string[] {
  return domains.filter((d) => d.verifiedAt).map((d) => d.name)
}

function canonicalDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export function isEmailAtDomains(
  email: string | null | undefined,
  domains: readonly string[]
): boolean {
  if (!email) return false
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const domain = canonicalDomain(email.slice(at + 1))
  return domains.some((d) => canonicalDomain(d) === domain)
}

/** What a rule naming a deleted role (or the Owner preset) does: nothing. */
export const MISSING_ROLE_NOTE =
  'Role no longer exists. This rule changes nothing until you pick another role.'

/**
 * The roles a rule may name, as the preview takes them. The Owner preset is
 * left out: sign-in never grants it from a rule, so a rule naming it reads as
 * a missing role.
 */
export function grantableRoles(
  roles: ReadonlyArray<{ id: string; key: string; name: string }>
): Array<{ id: string; name: string }> {
  return roles.filter((r) => r.key !== SYSTEM_ROLES.OWNER).map((r) => ({ id: r.id, name: r.name }))
}

type RuleMatch = {
  role: Role
  roleId?: string
  roleName?: string
  roleMissing?: true
  ruleIndex: number
}

export type SignInRoleOutcome =
  | { source: 'rule'; role: Role; roleId?: string; roleName?: string; ruleIndex: number }
  | { source: 'unchanged'; ruleIndex: number }
  | { source: 'domain'; role: Role }
  | { source: 'none' }

/**
 * The role sign-in gives one person: the rule they matched (from the preview,
 * which runs the production matcher), else the default role when their email
 * is at a verified domain, else nothing. A first match naming a missing role
 * stops there and changes nothing.
 */
export function signInRoleOutcome({
  ruleMatch,
  email,
  verifiedDomains,
  defaultRole,
}: {
  ruleMatch: RuleMatch | null
  email: string | null | undefined
  verifiedDomains: readonly string[]
  defaultRole: Role
}): SignInRoleOutcome {
  if (ruleMatch?.roleMissing) return { source: 'unchanged', ruleIndex: ruleMatch.ruleIndex }
  if (ruleMatch) {
    const { roleMissing: _missing, ...match } = ruleMatch
    return { source: 'rule', ...match }
  }
  if (isEmailAtDomains(email, verifiedDomains)) return { source: 'domain', role: defaultRole }
  return { source: 'none' }
}

/** "Admin (rule 1)", "Member (verified domain)" or "Portal user". */
export function describeSignInRole(outcome: SignInRoleOutcome): string {
  if (outcome.source === 'none') return ROLE_PRESET_LABELS.user
  if (outcome.source === 'unchanged') {
    return `No change (rule ${outcome.ruleIndex + 1} names a role that no longer exists)`
  }
  const name =
    outcome.source === 'rule' && outcome.roleId
      ? (outcome.roleName ?? 'Custom role')
      : ROLE_PRESET_LABELS[outcome.role]
  return outcome.source === 'rule'
    ? `${name} (rule ${outcome.ruleIndex + 1})`
    : `${name} (verified domain)`
}
