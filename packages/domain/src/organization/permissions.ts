import { type Role, hasMinimumRole } from '../roles'

export function canManageMembers(role: Role): boolean {
  return hasMinimumRole(role, 'admin')
}

export function canDeleteOrganization(role: Role): boolean {
  return role === 'owner'
}

export function canManageSettings(role: Role): boolean {
  return hasMinimumRole(role, 'admin')
}

export function canManageIntegrations(role: Role): boolean {
  return hasMinimumRole(role, 'admin')
}
