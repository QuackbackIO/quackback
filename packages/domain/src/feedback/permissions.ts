import { type Role, hasMinimumRole } from '../roles'

export function canCreateFeedback(role: Role): boolean {
  return hasMinimumRole(role, 'member')
}

export function canEditFeedback(role: Role): boolean {
  return hasMinimumRole(role, 'member')
}

export function canDeleteFeedback(role: Role): boolean {
  return hasMinimumRole(role, 'admin')
}
