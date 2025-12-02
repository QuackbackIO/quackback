import { type Role, hasMinimumRole } from '../roles'

export function canCreateBoard(role: Role): boolean {
  return hasMinimumRole(role, 'admin')
}

export function canEditBoard(role: Role): boolean {
  return hasMinimumRole(role, 'admin')
}

export function canDeleteBoard(role: Role): boolean {
  return hasMinimumRole(role, 'owner')
}

export function canViewBoardSettings(role: Role): boolean {
  return hasMinimumRole(role, 'admin')
}
